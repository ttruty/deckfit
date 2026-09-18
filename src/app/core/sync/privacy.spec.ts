import { vi } from 'vitest';
import { loadContent } from '../../../testing/db';
import { FakeRealtime } from '../../../testing/fake-realtime';
import { intervalRoomRoutine } from '../../../testing/sync';
import { bettingOf, currentPlayer, openClaim, teamCaptain } from '../../domain/engine/dsl/interpreter';
import { resolveSettings } from '../../domain/engine/dsl/settings';
import type { EngineEvent } from '../../domain/engine/events';
import type { IntentInput } from '../../domain/engine/intents';
import { reduce } from '../../domain/engine/reducer';
import type { GameState } from '../../domain/engine/state';
import { GameHost } from './game-host';
import { createGame } from './game-start';
import type { GameStart, NetMessage } from './net-message';
import { PrivateLink } from './private-link';
import { RoomGame, type RoomGameUpdate } from './room-game';
import { RoomSession } from './room-session';
import { SupabaseTransport } from './supabase-transport';

const content = loadContent();
const deck = content.decks.decks.find((d) => d.id === 'deck-bodyweight')!;
const CARD_IDS = new Set(deck.cards.map((c) => c.id));
const fast = { joinTimeoutMs: 40, createProbeMs: 10 };

/** Polls (real time: WebCrypto is asynchronous) until `ok()` or fails after `ms`. */
async function until(ok: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 2));
  }
}

/** Every string in a JSON value that is a card id of the deck. */
function cardIdsIn(value: unknown, out = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    if (CARD_IDS.has(value)) out.add(value);
  } else if (Array.isArray(value)) {
    for (const v of value) cardIdsIn(v, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) cardIdsIn(v, out);
  }
  return out;
}

type Policy = (view: GameState, me: string, turn: number) => IntentInput | null;

/**
 * Plays a hidden game on four simulated devices over one fake Supabase project. The host's
 * true states are recorded by seq (a spy on GameHost.apply), every device's received views by
 * seq, and the channel's raw wire.
 */
async function playHidden(gameId: string, players: string[], policy: Policy, turns: number) {
  const rt = new FakeRealtime();
  const sOpts = { clockSamples: 0 };
  const sessions: RoomSession[] = [];
  sessions.push(await RoomSession.host(new SupabaseTransport(rt, fast), { id: players[0], name: players[0] }, intervalRoomRoutine(), sOpts));
  for (const id of players.slice(1)) {
    await new Promise((r) => setTimeout(r, 2)); // distinct presence timestamps → stable seats
    sessions.push(await RoomSession.join(new SupabaseTransport(rt, fast), sessions[0].code, { id, name: id }, sOpts));
  }
  await until(() => sessions.every((s) => s.snapshot?.players.length === players.length));
  for (const s of sessions) s.setReady(true);
  await until(() => sessions[0].snapshot?.blocker === null);

  const truth: GameState[] = [];
  const trueEvents: EngineEvent[][] = [];
  const apply = GameHost.prototype.apply;
  const spy = vi.spyOn(GameHost.prototype, 'apply').mockImplementation(function (this: GameHost, intent) {
    if (!truth.length) truth.push(this.state);
    const step = apply.call(this, intent);
    truth[step.seq] = step.state;
    trueEvents[step.seq] = step.events;
    return step;
  });

  const game = content.games.games.find((g) => g.id === gameId)!;
  const start: GameStart = {
    seed: 4242, game, settings: resolveSettings(game),
    players: players.map((id, seat) => ({ id, name: id, seat })),
    deck: { id: deck.id, name: deck.name, suits: deck.suits, cards: deck.cards },
    exercises: content.exercises.exercises,
  };
  const games = new Map<string, RoomGame>();
  const received = new Map<string, RoomGameUpdate[]>(players.map((p) => [p, []]));
  for (const s of sessions) {
    s.onStart((st) => {
      const g = new RoomGame(s, st);
      games.set(s.me.id, g);
      g.updates$.subscribe((u) => received.get(s.me.id)!.push(u));
    });
  }
  sessions[0].start(start);
  const hostSeq = () => truth.length - 1;
  const synced = () => games.size === players.length && hostSeq() > 0 && [...games.values()].every((g) => received.get(g.me)!.at(-1)!.seq === hostSeq());
  await until(synced);

  for (let turn = 0; turn < turns; turn++) {
    const intents = [...games.values()].map((g) => [g, policy(g.state, g.me, turn)] as const).filter(([, i]) => i);
    if (!intents.length) break;
    const [g, intent] = intents[0];
    const before = hostSeq();
    g.dispatch(intent!);
    await until(() => hostSeq() > before && synced());
  }

  spy.mockRestore();
  const wire = (rt.wire.get(`deckfit:room:${sessions[0].code}`) ?? []) as { to?: string; msg: NetMessage }[];
  return { rt, sessions, games, received, truth, trueEvents, wire, start };
}

/**
 * The property: for each device V and each view it received for step n, every card id in that
 * view (state and events) is one V legitimately knows by step n — a card V or V's team held,
 * one that was face up or revealed, or one of V's own tasks. In particular it never contains a
 * card from another player's hand that V hasn't seen. Computed from the host's true states.
 */
function expectNoLeaks(run: Awaited<ReturnType<typeof playHidden>>, players: string[]) {
  let hiddenOthersCards = 0;
  for (const viewer of players) {
    const known = new Set<string>();
    const knownAt: Set<string>[] = [];
    run.truth.forEach((state, seq) => {
      const captain = teamCaptain(state, viewer);
      for (const id of [
        ...(state.zones.hands[viewer] ?? []), ...(state.zones.hands[captain] ?? []), ...state.faceUp,
        ...state.tasks.filter((t) => t.playerId === viewer).flatMap((t) => t.cardIds),
        ...(run.trueEvents[seq] ?? []).flatMap((e) => (e.type === 'CardsRevealed' ? e.cardIds : [])),
      ]) known.add(id);
      knownAt[seq] = new Set(known);
      for (const p of players) {
        if (teamCaptain(state, p) === captain) continue;
        hiddenOthersCards += (state.zones.hands[p] ?? []).filter((id) => !known.has(id)).length;
      }
    });
    const views = run.received.get(viewer)!;
    expect(views.length).toBeGreaterThan(2);
    for (const view of views) {
      const leaked = [...cardIdsIn(view)].filter((id) => !knownAt[view.seq].has(id));
      expect(leaked, `${viewer} at seq ${view.seq}`).toEqual([]);
    }
    // Non-vacuous: the viewer does see its own cards.
    const own = run.truth.at(-1)!.zones.hands[teamCaptain(run.truth.at(-1)!, viewer)] ?? [];
    if (own.length) expect([...cardIdsIn(views.at(-1)!.state)]).toEqual(expect.arrayContaining(own));
  }
  expect(hiddenOthersCards).toBeGreaterThan(0);
}

/** Nothing on the public channel names a card, except the deck itself in `start` (and routine bundles in room-state). */
function expectCleanWire(run: Awaited<ReturnType<typeof playHidden>>) {
  const kinds = new Set(run.wire.map((w) => w.msg.kind));
  expect(kinds.has('private')).toBe(true);
  for (const k of ['events', 'snapshot', 'intent', 'snapshot-request'] as const) expect(kinds.has(k)).toBe(false);
  for (const { msg } of run.wire) {
    if (msg.kind === 'start' || msg.kind === 'room-state') continue;
    expect([...cardIdsIn(msg)], msg.kind).toEqual([]);
  }
  // The public start can't be used to replay the shuffle.
  const publicStart = run.wire.find((w) => w.msg.kind === 'start')!.msg as Extract<NetMessage, { kind: 'start' }>;
  expect(publicStart.start.seed).toBe(0);
  const { ctx, initial } = createGame(publicStart.start);
  const guessed = reduce(initial, { type: 'deal', playerId: run.start.players[0].id }, ctx).state;
  expect(guessed.zones.draw).not.toEqual(run.truth[1].zones.draw);
}

function withTasks(policy: Policy): Policy {
  return (view, me, turn) => {
    if (view.phase !== 'playing') return null;
    const mine = view.tasks.find((t) => t.status === 'pending' && t.playerId === me);
    if (mine) return { type: 'completeTask', taskId: mine.id };
    if (view.tasks.some((t) => t.status === 'pending')) return null;
    return policy(view, me, turn);
  };
}

describe('hidden games: per-player private channels', () => {
  it('fit-poker: no device ever receives another player’s unrevealed hand (folded hands stay hidden)', async () => {
    const players = ['ann', 'bo', 'cy'];
    const run = await playHidden('fit-poker', players, withTasks((view, me) => {
      if (currentPlayer(view) !== me) return null;
      const bet = bettingOf(view);
      if (!bet.active) return { type: 'flip' };
      const stake = bet.stakes[me] ?? 0;
      if (bet.current > stake) return me === 'cy' ? { type: 'pass' } : { type: 'call' };
      return me === 'ann' && stake === 0 ? { type: 'bet', amount: 2 } : { type: 'pass' };
    }), 40);
    const all = run.trueEvents.flat();
    expect(all.some((e) => e.type === 'PlayerFolded')).toBe(true);
    expect(all.some((e) => e.type === 'CardsRevealed')).toBe(true);
    expectNoLeaks(run, players);
    expectCleanWire(run);

    // Someone else's view of a folded player's pot task shows the work, not the card.
    const cyTask = run.truth.at(-1)!.tasks.find((t) => t.playerId === 'cy');
    if (cyTask) {
      const seen = run.received.get('bo')!.at(-1)!.state.tasks.find((t) => t.id === cyTask.id)!;
      expect(seen).toMatchObject({ amount: cyTask.amount, cardIds: ['?'], exerciseId: null });
    }
    for (const g of run.games.values()) g.dispose();
  });

  it('bluff-pile: claims stay face down for everyone else; only a challenge reveals them', async () => {
    const players = ['ann', 'bo', 'cy'];
    const run = await playHidden('bluff-pile', players, withTasks((view, me, turn) => {
      if (currentPlayer(view) !== me) return null;
      const open = openClaim(view);
      if (open && open.by !== me && turn % 3 === 2) return { type: 'call' };
      return { type: 'claim', cardIds: [view.zones.hands[me][0]] };
    }), 30);
    const all = run.trueEvents.flat();
    expect(all.filter((e) => e.type === 'ClaimMade').length).toBeGreaterThan(3);
    expect(all.some((e) => e.type === 'ClaimChallenged')).toBe(true);
    expectNoLeaks(run, players);
    expectCleanWire(run);
    for (const g of run.games.values()) g.dispose();
  });

  it('team-relay: teammates share their hand; the other team never sees it', async () => {
    const players = ['ann', 'bo', 'cy', 'dee']; // teams by seat: ann+cy, bo+dee
    const run = await playHidden('team-relay', players, withTasks((view, me) => (currentPlayer(view) === me ? { type: 'flip' } : null)), 12);
    const last = (id: string) => run.received.get(id)!.at(-1)!.state;
    expect(last('cy').zones.hands['ann']).toEqual(run.truth.at(-1)!.zones.hands['ann']); // cy sees their captain's hand
    expect(last('bo').zones.hands['ann'].every((id) => id === '?')).toBe(true);
    expectNoLeaks(run, players);
    expectCleanWire(run);
    for (const g of run.games.values()) g.dispose();
  });

  it('an eavesdropper on the channel can’t read or redirect anyone’s private messages, and sees no cards', async () => {
    const players = ['ann', 'bo', 'cy'];
    const run = await playHidden('bluff-pile', players, withTasks((view, me) =>
      currentPlayer(view) === me ? { type: 'claim', cardIds: [view.zones.hands[me][0]] } : null), 3);

    const eveTransport = new SupabaseTransport(run.rt, fast);
    await eveTransport.joinRoom(run.sessions[0].code, { id: 'eve', name: 'Eve' });
    const eve = new PrivateLink(eveTransport, 'eve', run.sessions[0].code);
    const got: unknown[] = [];
    eve.messages$.subscribe((m) => got.push(m));
    await eve.start();
    await until(() => eve.hasKey('ann'));

    // Re-address every private message on the wire to Eve: the AES-GCM keys and associated data don't match.
    const privates = run.wire.map((w) => w.msg).filter((m): m is Extract<NetMessage, { kind: 'private' }> => m.kind === 'private');
    expect(privates.length).toBeGreaterThan(5);
    for (const m of privates) run.rt.inject(`deckfit:room:${run.sessions[0].code}`, 'msg', { to: 'eve', msg: { ...m, to: 'eve' } });
    await until(() => eve.dropped === privates.length);

    // Anyone in the room may watch (a latecomer joins as a spectator, §7), but a watcher's view
    // is fully redacted: hand sizes and turns, never a card.
    eve.send('ann', { kind: 'view-request' });
    await until(() => got.length > 0);
    const view = got[0] as { from: string; msg: { kind: string; state: unknown } };
    expect(view.from).toBe('ann');
    expect(view.msg.kind).toBe('view');
    expect([...cardIdsIn(view.msg.state)]).toEqual([]);
    expect((view.msg.state as { rngState: number }).rngState).toBe(0);
    expect(Object.values((view.msg.state as { zones: { hands: Record<string, string[]> } }).zones.hands).flat().every((id) => id === '?')).toBe(true);

    // And she still can't act: the host only takes intents from seated players.
    const before = run.received.get('ann')!.length;
    eve.send('ann', { kind: 'intent', intent: { type: 'flip', playerId: 'ann' } });
    await new Promise((r) => setTimeout(r, 80));
    expect(run.received.get('ann')!.length).toBe(before);
    eve.stop();
    for (const g of run.games.values()) g.dispose();
  });
});
