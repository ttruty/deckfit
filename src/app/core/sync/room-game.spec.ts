import { firstValueFrom, filter } from 'rxjs';
import { counter, hasActed } from '../../domain/engine/dsl/interpreter';
import { HIDDEN_CARD } from '../../domain/engine/redact';
import { hashState } from '../../domain/engine/hash';
import { resolveSettings } from '../../domain/engine/dsl/settings';
import { loadContent } from '../../../testing/db';
import { flush, intervalRoomRoutine } from '../../../testing/sync';
import { LoopbackHub, LoopbackTransport } from './loopback-transport';
import type { GameStart } from './net-message';
import { LEAVE_AFTER_MS, RoomGame } from './room-game';
import { HOST_MIGRATION_MS, RoomSession } from './room-session';
import { ManualScheduler } from './scheduler';

const content = loadContent();
const deck = content.decks.decks.find((d) => d.id === 'deck-bodyweight')!;

function startFor(gameId: string, players: { id: string; name: string }[], seed = 2026, settings = {}): GameStart {
  const game = content.games.games.find((g) => g.id === gameId)!;
  return {
    seed, game, settings: resolveSettings(game, settings),
    players: players.map((p, seat) => ({ ...p, seat })),
    deck: { id: deck.id, name: deck.name, suits: deck.suits, cards: deck.cards },
    exercises: content.exercises.exercises,
  };
}

async function room(gameId: string, opts: { scheduler?: ManualScheduler; settings?: Record<string, unknown> } = {}) {
  const hub = new LoopbackHub();
  const sOpts = { clockSamples: 0, ...(opts.scheduler ? { scheduler: opts.scheduler } : {}) };
  const ann = await RoomSession.host(new LoopbackTransport(hub), { id: 'ann', name: 'Ann' }, intervalRoomRoutine(), sOpts);
  const bo = await RoomSession.join(new LoopbackTransport(hub), ann.code, { id: 'bo', name: 'Bo' }, sOpts);
  const cy = await RoomSession.join(new LoopbackTransport(hub), ann.code, { id: 'cy', name: 'Cy' }, sOpts);
  await flush();
  const sessions = [ann, bo, cy];
  for (const s of sessions) s.setReady(true);
  await flush();
  const games: RoomGame[] = [];
  const gOpts = opts.scheduler ? { scheduler: opts.scheduler } : {};
  for (const s of sessions) s.onStart((start, resumed) => games.push(new RoomGame(s, start, { ...gOpts, resumed })));
  ann.start(startFor(gameId, sessions.map((s) => s.me), 2026, opts.settings ?? {}));
  await flush(12);
  return { hub, sessions, games, gOpts, byId: (id: string) => games.find((g) => g.me === id)! };
}

describe('RoomGame (3 loopback devices)', () => {
  it('start → the host deals and every device holds the same state', async () => {
    const { games } = await room('high-card-duel');
    expect(games).toHaveLength(3);
    expect(games.filter((g) => g.isHost).map((g) => g.me)).toEqual(['ann']);
    expect(games[0].state.phase).toBe('playing');
    expect(new Set(games.map((g) => hashState(g.state))).size).toBe(1);
  });

  it('a full high-card-duel round played from three devices', async () => {
    const { games, byId } = await room('high-card-duel');
    for (const id of ['cy', 'ann', 'bo']) byId(id).dispatch({ type: 'flip' });
    await flush(12);
    const state = byId('ann').state;
    expect(state.tasks.length).toBeGreaterThan(0); // someone lost
    expect(new Set(games.map((g) => hashState(g.state))).size).toBe(1);
    // Each loser completes their own tasks from their own device.
    for (const t of state.tasks) byId(t.playerId).dispatch({ type: 'completeTask', taskId: t.id });
    await flush(12);
    expect(byId('bo').state.tasks.every((t) => t.status === 'done')).toBe(true);
  });

  it('neighbor-rush: plays reach the host through the timing window; a rejected play is reported to its sender only', async () => {
    const scheduler = new ManualScheduler();
    const { games, byId } = await room('neighbor-rush', { scheduler });
    const state = byId('ann').state;
    const rejectedFor: string[] = [];
    for (const g of games) g.rejections$.subscribe((r) => rejectedFor.push(`${g.me}:${r.reason}`));
    // Bo plays a card from Cy's hand: not-in-hand, reported to Bo only.
    byId('bo').dispatch({ type: 'play', cardId: state.zones.hands['cy'][0] });
    await flush();
    scheduler.advance(300);
    await flush(12);
    expect(rejectedFor).toEqual(['bo:not-in-hand']);
    expect(new Set(games.map((g) => hashState(g.state))).size).toBe(1);
  });

  it('the host leaves mid-game: after 10 s the next device continues hosting from its state', async () => {
    const scheduler = new ManualScheduler();
    const { sessions, games, byId } = await room('high-card-duel', { scheduler });
    byId('bo').dispatch({ type: 'flip' });
    await flush(12);
    const before = hashState(byId('bo').state);
    byId('ann').dispose();
    await sessions[0].leave();
    await flush();
    scheduler.advance(HOST_MIGRATION_MS);
    await flush(12);
    expect(byId('bo').isHost).toBe(true);
    expect(hashState(byId('bo').state)).toBe(before);
    byId('cy').dispatch({ type: 'flip' });
    await flush(12);
    // Only Bo and Cy remain in the room, but Ann is still seated in the game: the round waits for her flip.
    expect(hashState(byId('cy').state)).toBe(hashState(byId('bo').state));
    await firstValueFrom(byId('cy').updates$.pipe(filter((u) => u.seq >= 2)));
    expect(games.length).toBe(3);
  });
});

describe('RoomGame dropouts', () => {
  it('a player who leaves the room is dropped from the game, so the round can finish', async () => {
    const scheduler = new ManualScheduler();
    const { sessions, byId } = await room('high-card-duel', { scheduler });
    byId('ann').dispatch({ type: 'flip' });
    byId('bo').dispatch({ type: 'flip' });
    await flush(12);
    // Cy hasn't flipped: the round is stuck on them.
    expect(byId('ann').state.tasks.filter((t) => t.status === 'pending')).toHaveLength(0);
    expect(counter(byId('ann').state, 'round')).toBe(0);

    await sessions[2].leave();
    byId('cy').dispose();
    await flush();
    scheduler.advance(LEAVE_AFTER_MS);
    await flush(12);

    const state = byId('ann').state;
    expect(state.players.find((p) => p.id === 'cy')?.left).toBe(true);
    expect(state.turn.order).toEqual(['ann', 'bo']);
    expect(counter(state, 'round')).toBe(1); // the round resolved between the two who stayed
    expect(hashState(byId('bo').state)).toBe(hashState(state));

    // The game carries on with two players (the round's losers work first).
    for (const t of state.tasks.filter((x) => x.status === 'pending')) byId(t.playerId).dispatch({ type: 'completeTask', taskId: t.id });
    await flush(12);
    byId('ann').dispatch({ type: 'flip' });
    byId('bo').dispatch({ type: 'flip' });
    await flush(12);
    expect(counter(byId('bo').state, 'round')).toBe(2);
  });
});

describe('RoomGame with a judge (rep-race)', () => {
  it('the round\u2019s judge gets no cards and marks the racers done', async () => {
    const scheduler = new ManualScheduler();
    const { byId } = await room('rep-race', { scheduler, settings: { judge: true, rounds: 2 } });
    // rep-race holds completeTask for its timing window (§7), so the clock has to move on.
    const settle = async () => {
      await flush();
      scheduler.advance(300);
      await flush(12);
    };
    byId('ann').dispatch({ type: 'flip' }); // deals the round
    await settle();

    // Round 1 is judged by the first seat: Ann has no tasks, Bo and Cy race.
    const state = byId('ann').state;
    expect(state.tasks.filter((t) => t.playerId === 'ann')).toHaveLength(0);
    const bosTask = state.tasks.find((t) => t.playerId === 'bo' && t.status === 'pending')!;
    expect(bosTask).toBeDefined();

    // Cy can't mark Bo's task; the judge can.
    byId('cy').dispatch({ type: 'completeTask', taskId: bosTask.id });
    await settle();
    expect(byId('ann').state.tasks.find((t) => t.id === bosTask.id)!.status).toBe('pending');
    byId('ann').dispatch({ type: 'completeTask', taskId: bosTask.id });
    await settle();
    expect(byId('bo').state.tasks.find((t) => t.id === bosTask.id)!.status).toBe('done');
    expect(byId('bo').state.totals['bo']).toBeDefined(); // the work counts for Bo, not the judge
    expect(Object.keys(byId('bo').state.totals['ann'] ?? {})).toEqual([]);
  });
});

describe('arriving after the game has started', () => {
  /** Joins `hub`'s room as a new device and builds whatever game the host hands it. */
  async function joinLate(hub: LoopbackHub, code: string, who: { id: string; name: string }, gOpts: object) {
    const session = await RoomSession.join(new LoopbackTransport(hub), code, who, { clockSamples: 0 });
    let game: RoomGame | null = null;
    session.onStart((start, resumed) => (game = new RoomGame(session, start, { ...gOpts, resumed })));
    await flush(16);
    return { session, game: game as unknown as RoomGame };
  }

  it('a newcomer watches the running game instead of being stranded in the lobby', async () => {
    const { hub, sessions, byId, gOpts } = await room('high-card-duel');
    byId('ann').dispatch({ type: 'flip' });
    await flush(12);

    const late = await joinLate(hub, sessions[0].code, { id: 'dee', name: 'Dee' }, gOpts);
    expect(late.game).toBeTruthy();
    expect(late.game.spectator).toBe(true);
    expect(late.game.resumed).toBe(true);
    expect(late.game.isHost).toBe(false);
    // They see the real game, not a fresh one.
    expect(hashState(late.game.state)).toBe(hashState(byId('ann').state));

    // Watching only: their intents never reach the engine.
    const before = hashState(byId('ann').state);
    late.game.dispatch({ type: 'flip' });
    await flush(12);
    expect(hashState(byId('ann').state)).toBe(before);

    // The players carry on around them.
    byId('bo').dispatch({ type: 'flip' });
    byId('cy').dispatch({ type: 'flip' });
    await flush(12);
    expect(hashState(late.game.state)).toBe(hashState(byId('ann').state));
    expect(late.game.state.players.map((p) => p.id)).not.toContain('dee');
  });

  it('a newcomer to a hidden game sees the table but nobody\u2019s cards', async () => {
    const { hub, sessions, byId, gOpts } = await room('fit-poker', { settings: { rounds: 2 } });
    byId('ann').dispatch({ type: 'flip' }); // deals five cards to each player
    await flush(20);
    expect(byId('ann').state.zones.hands['ann'].filter((id) => id !== HIDDEN_CARD)).toHaveLength(5);

    const late = await joinLate(hub, sessions[0].code, { id: 'dee', name: 'Dee' }, gOpts);
    await flush(20);
    expect(late.game.spectator).toBe(true);
    // Every hand is '?' to them: hand sizes are public, the cards are not.
    const hands = Object.values(late.game.state.zones.hands);
    expect(hands.flat().length).toBeGreaterThan(0);
    expect(hands.flat().every((id) => id === HIDDEN_CARD)).toBe(true);
    expect(late.game.state.rngState).toBe(0);
  });

  it('a player who reloads mid-game comes back as a player, not as a new game', async () => {
    const { hub, sessions, byId, gOpts } = await room('high-card-duel');
    byId('ann').dispatch({ type: 'flip' });
    await flush(12);
    const stateBefore = hashState(byId('ann').state);

    // Bo's device goes away and comes back with the same id (a reload).
    byId('bo').dispose();
    await sessions[1].leave();
    await flush();
    const back = await joinLate(hub, sessions[0].code, { id: 'bo', name: 'Bo' }, gOpts);

    expect(back.game.spectator).toBe(false);
    expect(back.game.resumed).toBe(true);
    expect(hashState(back.game.state)).toBe(stateBefore); // resumed the running game, didn't restart it
    expect(hashState(byId('ann').state)).toBe(stateBefore); // and the host's game is untouched

    // Bo can play again.
    back.game.dispatch({ type: 'flip' });
    await flush(12);
    expect(hasActed(byId('ann').state, 'bo')).toBe(true);
  });
});
