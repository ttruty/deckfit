import { hashState } from '../../domain/engine/hash';
import { loadContent } from '../../../testing/db';
import { flush } from '../../../testing/sync';
import { GameClient } from './game-client';
import { GameHost } from './game-host';
import { createGame } from './game-start';
import { LoopbackHub, LoopbackTransport } from './loopback-transport';
import type { GameStart } from './net-message';
import { ManualScheduler } from './scheduler';

const content = loadContent();
const def = content.games.games.find((g) => g.id === 'neighbor-rush')!;
const deck = content.decks.decks.find((d) => d.id === 'deck-bodyweight')!;
const card = (suit: string, rank: string) => deck.cards.find((c) => c.suit === suit && c.rank === rank)!.id;

/**
 * A neighbor-rush table where Ann and Bo both hold a card that fits the center (7♥) but not
 * each other: Ann 8♣ (neighbor rank), Bo 2♥ (same suit). Whoever is applied first wins.
 */
async function contestedTable(windowMs = 300) {
  const hub = new LoopbackHub();
  const players = [{ id: 'ann', name: 'Ann', seat: 0 }, { id: 'bo', name: 'Bo', seat: 1 }];
  const start: GameStart = {
    seed: 1, players, game: def, deck: { id: deck.id, name: deck.name, suits: deck.suits, cards: deck.cards },
    settings: { repMultiplier: 1, faceCardValue: 10, aceValue: 11, jokerRule: 'skip', players: def.players, handSize: 5 },
    exercises: content.exercises.exercises,
  };
  const scheduler = new ManualScheduler();
  const hostT = new LoopbackTransport(hub);
  const { code } = await hostT.createRoom(players[0]);
  const g = createGame(start);
  // Rig the dealt state directly: center 7♥; Ann 8♣ + 3♠; Bo 2♥ + 3♦.
  const initial = {
    ...g.initial, phase: 'playing' as const,
    zones: {
      ...g.initial.zones,
      table: [card('hearts', '7')],
      hands: { ann: [card('clubs', '8'), card('spades', '3')], bo: [card('hearts', '2'), card('diamonds', '3')] },
      draw: g.initial.zones.draw.filter((id) => ![card('hearts', '7'), card('clubs', '8'), card('spades', '3'), card('hearts', '2'), card('diamonds', '3')].includes(id)),
    },
  };
  const host = new GameHost(hostT, g.ctx, initial, { timing: { windowMs, intents: def.timing!.intents }, scheduler });
  host.start();
  const boT = new LoopbackTransport(hub);
  await boT.joinRoom(code, players[1]);
  const boGame = createGame(start);
  const bo = new GameClient(boT, boGame.ctx, initial, 'bo');
  bo.start();
  const annClient = new GameClient(hostT, g.ctx, initial, 'ann');
  annClient.start();
  await flush();
  return { host, hostT, boT, bo, annClient, scheduler, cards: { ann: card('clubs', '8'), bo: card('hearts', '2'), center: card('hearts', '7') } };
}

describe('timing conflict resolution (§7)', () => {
  it('two plays on the same center: earliest corrected send time wins even if it arrives second', async () => {
    const t = await contestedTable();
    // Bo's play arrives first but was sent later; Ann's arrives second with an earlier sentAt.
    t.boT.send({ kind: 'intent', from: 'bo', intent: { type: 'play', playerId: 'bo', cardId: t.cards.bo }, sentAt: 5_000 });
    await flush();
    t.hostT.send({ kind: 'intent', from: 'ann', intent: { type: 'play', playerId: 'ann', cardId: t.cards.ann }, sentAt: 4_990 });
    await flush();
    expect(t.host.seq).toBe(0); // held in the window
    t.scheduler.advance(300);
    await flush();

    expect(t.host.state.zones.table).toEqual([t.cards.center, t.cards.ann]);
    const boRejection = t.host.log.find((e) => e.type === 'IntentRejected');
    expect(boRejection).toEqual({ type: 'IntentRejected', playerId: 'bo', intent: 'play', reason: 'no-match' });
    expect(t.host.state.zones.hands['bo']).toContain(t.cards.bo); // returned to hand (never left)
    // Everyone agrees on the outcome.
    expect(hashState(t.bo.state)).toBe(hashState(t.host.state));
  });

  it('identical send times: the lower seat wins', async () => {
    const t = await contestedTable();
    t.boT.send({ kind: 'intent', from: 'bo', intent: { type: 'play', playerId: 'bo', cardId: t.cards.bo }, sentAt: 7_000 });
    t.hostT.send({ kind: 'intent', from: 'ann', intent: { type: 'play', playerId: 'ann', cardId: t.cards.ann }, sentAt: 7_000 });
    await flush();
    t.scheduler.advance(300);
    await flush();
    expect(t.host.state.zones.table.at(-1)).toBe(t.cards.ann);
  });

  it('a play outside the window is simply applied in its own batch; non-timed intents are not held', async () => {
    const t = await contestedTable();
    t.boT.send({ kind: 'intent', from: 'bo', intent: { type: 'play', playerId: 'bo', cardId: t.cards.bo }, sentAt: 1 });
    await flush();
    t.scheduler.advance(300);
    await flush();
    expect(t.host.state.zones.table.at(-1)).toBe(t.cards.bo);
    t.hostT.send({ kind: 'intent', from: 'ann', intent: { type: 'pass', playerId: 'ann' } });
    await flush();
    expect(t.host.log.at(-1)?.type).toBe('CardsDealt'); // pass applied immediately
  });

  it('GameClient stamps sentAt from the host clock estimate', async () => {
    const hub = new LoopbackHub();
    const t = new LoopbackTransport(hub);
    await t.createRoom({ id: 'ann', name: 'Ann' });
    const seen: (number | undefined)[] = [];
    t.messages$.subscribe((m) => m.kind === 'intent' && seen.push(m.sentAt));
    const g = createGame({ seed: 1, players: [{ id: 'ann', name: 'Ann', seat: 0 }], game: def, deck, settings: { repMultiplier: 1, faceCardValue: 10, aceValue: 11, jokerRule: 'skip', players: def.players, handSize: 5 }, exercises: content.exercises.exercises });
    new GameClient(t, g.ctx, g.initial, 'ann', () => 123_456).send({ type: 'pass' });
    await flush();
    expect(seen).toEqual([123_456]);
  });
});
