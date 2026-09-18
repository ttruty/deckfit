import { firstValueFrom, take, toArray } from 'rxjs';
import { loadContent } from '../../../testing/db';
import { createDslRules } from '../../domain/engine/dsl/interpreter';
import { resolveSettings } from '../../domain/engine/dsl/settings';
import { hashState } from '../../domain/engine/hash';
import { createContext, createInitialState } from '../../domain/engine/reducer';
import { GameHost, replay } from './game-host';
import type { NetMessage } from './net-message';
import { normalizeRoomCode } from './room-code';
import { LoopbackHub, LoopbackTransport } from './loopback-transport';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('LoopbackTransport', () => {
  it('creates a valid 6-character room and reports presence to everyone', async () => {
    const hub = new LoopbackHub();
    const a = new LoopbackTransport(hub);
    const b = new LoopbackTransport(hub);
    const room = await a.createRoom({ id: 'a', name: 'Ann' });
    expect(normalizeRoomCode(room.code)).toBe(room.code);
    await b.joinRoom(room.code, { id: 'b', name: 'Bo' });
    const seen = await firstValueFrom(a.presence$);
    expect(seen).toEqual([
      { id: 'a', name: 'Ann', seat: 0, isHost: true, online: true },
      { id: 'b', name: 'Bo', seat: 1, isHost: false, online: true },
    ]);
    await b.leave();
    expect((await firstValueFrom(a.presence$)).map((p) => p.id)).toEqual(['a']);
    await expect(new LoopbackTransport(hub).joinRoom('NOPE00', { id: 'c', name: 'C' })).rejects.toThrow();
  });

  it('broadcasts to all members (async), or to one member with `to`', async () => {
    const hub = new LoopbackHub();
    const a = new LoopbackTransport(hub);
    const b = new LoopbackTransport(hub);
    const { code } = await a.createRoom({ id: 'a', name: 'A' });
    await b.joinRoom(code, { id: 'b', name: 'B' });
    const gotA: NetMessage[] = [];
    const gotB: NetMessage[] = [];
    a.messages$.subscribe((m) => gotA.push(m));
    b.messages$.subscribe((m) => gotB.push(m));

    const msg: NetMessage = { kind: 'snapshot-request', from: 'b' };
    b.send(msg);
    expect(gotA).toEqual([]); // not synchronous
    await tick();
    expect(gotA).toEqual([msg]);
    expect(gotB).toEqual([msg]);

    a.send({ kind: 'snapshot-request', from: 'a' }, 'b');
    await tick();
    expect(gotA).toHaveLength(1);
    expect(gotB).toHaveLength(2);
  });

  it('drops invalid messages on receipt', async () => {
    const t = new LoopbackTransport();
    await t.createRoom({ id: 'a', name: 'A' });
    const got: NetMessage[] = [];
    t.messages$.subscribe((m) => got.push(m));
    t.send({ kind: 'intent', from: 'a', intent: { type: 'bogus' } } as unknown as NetMessage);
    await tick();
    expect(got).toEqual([]);
    expect(t.dropped).toBe(1);
  });
});

describe('GameHost', () => {
  const content = loadContent();
  const def = content.games.games.find((g) => g.id === 'solo-deal')!;
  const deck = content.decks.decks.find((d) => d.id === 'deck-bodyweight')!;
  const ctx = createContext(deck, content.exercises.exercises, resolveSettings(def), createDslRules(def));
  const initial = () => createInitialState({ players: ['me'], seed: 2026, deck });

  it('reduces intents from the transport and broadcasts seq, events, and a state hash', async () => {
    const transport = new LoopbackTransport();
    await transport.createRoom({ id: 'me', name: 'Me' });
    const host = new GameHost(transport, ctx, initial());
    host.start();
    const broadcasts = firstValueFrom(transport.messages$.pipe(take(4), toArray()));

    transport.send({ kind: 'intent', from: 'me', intent: { type: 'deal', playerId: 'me' } });
    await tick();
    transport.send({ kind: 'intent', from: 'me', intent: { type: 'flip', playerId: 'me' } });
    const msgs = await broadcasts;
    const events = msgs.filter((m) => m.kind === 'events');
    expect(events.map((m) => m.seq)).toEqual([1, 2]);
    expect(events[1].events.map((e) => e.type)).toEqual(['CardFlipped', 'TaskAssigned']);
    expect(events[1].stateHash).toBe(hashState(host.state));
    host.stop();
  });

  it('broadcasts rejections as events and notifies local step listeners', async () => {
    const transport = new LoopbackTransport();
    await transport.createRoom({ id: 'me', name: 'Me' });
    const host = new GameHost(transport, ctx, initial());
    const steps: number[] = [];
    host.onStep((s) => steps.push(s.seq));
    const step = host.apply({ type: 'flip', playerId: 'me' });
    expect(step.events[0]).toMatchObject({ type: 'IntentRejected', reason: 'not-dealt' });
    expect(steps).toEqual([1]);
  });

  it('replaying the intents reproduces the same state and events', async () => {
    const transport = new LoopbackTransport();
    await transport.createRoom({ id: 'me', name: 'Me' });
    const host = new GameHost(transport, ctx, initial());
    const applied = [host.apply({ type: 'deal', playerId: 'me' }), host.apply({ type: 'flip', playerId: 'me' })];
    const taskId = host.state.tasks[0].id;
    applied.push(host.apply({ type: 'completeTask', playerId: 'me', taskId, amount: 3 }));
    const again = replay(initial(), applied.map((s) => s.intent), ctx);
    expect(hashState(again.state)).toBe(hashState(host.state));
    expect(again.events).toEqual(applied.flatMap((s) => s.events));
  });
});

describe('hashState', () => {
  it('ignores key order and undefined values but not content', () => {
    expect(hashState({ a: 1, b: [1, { c: 2, d: undefined }] })).toBe(hashState({ b: [1, { c: 2 }], a: 1 }));
    expect(hashState({ a: 1 })).not.toBe(hashState({ a: 2 }));
  });
});
