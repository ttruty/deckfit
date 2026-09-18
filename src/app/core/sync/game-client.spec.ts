import { hashState } from '../../domain/engine/hash';
import type { GameState } from '../../domain/engine/state';
import { flush, intervalStart, LossyTransport } from '../../../testing/sync';
import { GameClient } from './game-client';
import { GameHost } from './game-host';
import { createGame } from './game-start';
import { LoopbackHub, LoopbackTransport } from './loopback-transport';
import type { SyncTransport } from './sync-transport';

const players = [{ id: 'ann', name: 'Ann' }, { id: 'bo', name: 'Bo' }, { id: 'cy', name: 'Cy' }];

/** Host (ann) + two clients, all built from the same start payload. `wrap` lets a test degrade a client's link. */
async function table(wrap: (t: LoopbackTransport, id: string) => SyncTransport = (t) => t) {
  const hub = new LoopbackHub();
  const start = intervalStart(players);
  const hostT = new LoopbackTransport(hub);
  const { code } = await hostT.createRoom(players[0]);
  const hostGame = createGame(start);
  const host = new GameHost(hostT, hostGame.ctx, hostGame.initial);
  host.start();

  const clients = await Promise.all(
    players.slice(1).map(async (p) => {
      const raw = new LoopbackTransport(hub);
      await raw.joinRoom(code, p);
      const transport = wrap(raw, p.id);
      const game = createGame(start);
      const client = new GameClient(transport, game.ctx, game.initial, p.id);
      client.start();
      return { id: p.id, raw, transport, client };
    }),
  );
  await flush();
  return { hub, code, host, hostT, clients };
}

/** Plays like simulate(): each player completes their own pending tasks; the host player flips and ends timers. */
async function playRounds(t: Awaited<ReturnType<typeof table>>, maxSteps = 200) {
  const { host, hostT, clients } = t;
  for (let i = 0; i < maxSteps && host.state.phase !== 'finished'; i++) {
    const s = host.state;
    const task = s.tasks.find((x) => x.status === 'pending');
    if (task) {
      const client = clients.find((c) => c.id === task.playerId);
      if (client) client.client.send({ type: 'completeTask', taskId: task.id });
      else hostT.send({ kind: 'intent', from: 'ann', intent: { type: 'completeTask', playerId: 'ann', taskId: task.id } });
    } else if (s.timers[0]) {
      hostT.send({ kind: 'intent', from: 'ann', intent: { type: 'timerElapsed', playerId: 'ann', timerId: s.timers[0].id } });
    } else {
      hostT.send({ kind: 'intent', from: 'ann', intent: { type: s.phase === 'setup' ? 'deal' : 'flip', playerId: 'ann' } });
    }
    await flush(3);
  }
  await flush();
}

const hashes = (host: GameHost, clients: { client: GameClient }[]) => [host.state, ...clients.map((c) => c.client.state)].map(hashState);

describe('host-authoritative loop (host + 2 loopback clients)', () => {
  it('a whole interval-deck game stays identical on every peer, seq by seq', async () => {
    const t = await table();
    const seen: number[] = [];
    t.clients[0].client.onUpdate((u) => seen.push(u.seq));
    await playRounds(t);
    expect(t.host.state.phase).toBe('finished');
    expect(new Set(hashes(t.host, t.clients)).size).toBe(1);
    for (const { client } of t.clients) {
      expect(client.seq).toBe(t.host.seq);
      expect(client.log).toEqual(t.host.log);
      expect(client.stats).toEqual({ duplicates: 0, gaps: 0, mismatches: 0, snapshots: 0 });
    }
    expect(seen).toEqual(Array.from({ length: t.host.seq }, (_, i) => i + 1));
    // Every player worked: each has totals from their own tasks.
    expect(Object.keys(t.host.state.totals).every((id) => Object.keys(t.host.state.totals[id]).length > 0)).toBe(true);
  });

  it('a dropped update (seq gap) triggers a snapshot; the client catches up and keeps applying', async () => {
    const t = await table((raw, id) => {
      const lossy = new LossyTransport(raw);
      if (id === 'bo') [2, 5, 6].forEach((s) => lossy.dropEventsSeq.add(s));
      return lossy;
    });
    await playRounds(t);
    const bo = t.clients.find((c) => c.id === 'bo')!.client;
    expect(bo.stats.gaps).toBeGreaterThanOrEqual(1);
    expect(bo.stats.snapshots).toBeGreaterThanOrEqual(1);
    expect(new Set(hashes(t.host, t.clients)).size).toBe(1);
    expect(bo.log).toEqual(t.host.log);
    expect(t.clients.find((c) => c.id === 'cy')!.client.stats.snapshots).toBe(0); // only the lossy peer resynced
  });

  it('a state hash mismatch (diverged client) triggers a snapshot and converges', async () => {
    const t = await table();
    t.hostT.send({ kind: 'intent', from: 'ann', intent: { type: 'deal', playerId: 'ann' } });
    await flush();
    const cy = t.clients.find((c) => c.id === 'cy')!.client;
    // Corrupt cy's local copy behind its back.
    (cy as unknown as { _state: GameState })._state = { ...cy.state, rngState: 12345 };
    t.hostT.send({ kind: 'intent', from: 'ann', intent: { type: 'flip', playerId: 'ann' } });
    await flush();
    expect(cy.stats.mismatches).toBe(1);
    expect(cy.stats.snapshots).toBe(1);
    expect(hashState(cy.state)).toBe(hashState(t.host.state));
    expect(cy.seq).toBe(t.host.seq);
  });

  it('duplicates are ignored', async () => {
    const t = await table();
    t.hostT.send({ kind: 'intent', from: 'ann', intent: { type: 'deal', playerId: 'ann' } });
    await flush();
    const bo = t.clients[0];
    bo.raw.receive({ kind: 'events', seq: 1, intent: { type: 'deal', playerId: 'ann' }, events: [], stateHash: 'x' });
    await flush();
    expect(bo.client.stats.duplicates).toBe(1);
    expect(bo.client.seq).toBe(1);
  });

  it('the host drops intents whose playerId does not match the sender', async () => {
    const t = await table();
    t.hostT.send({ kind: 'intent', from: 'ann', intent: { type: 'deal', playerId: 'ann' } });
    await flush();
    const bo = t.clients[0];
    bo.transport.send({ kind: 'intent', from: 'bo', intent: { type: 'flip', playerId: 'ann' } });
    await flush();
    expect(t.host.spoofed).toBe(1);
    expect(t.host.seq).toBe(1);
  });

  it('a late joiner can sync from nothing with a snapshot', async () => {
    const t = await table();
    await playRounds(t, 12);
    const late = new LoopbackTransport(t.hub);
    await late.joinRoom(t.code, { id: 'di', name: 'Di' });
    const game = createGame(intervalStart(players));
    const client = new GameClient(late, game.ctx, game.initial, 'di');
    client.start();
    client.requestSnapshot();
    await flush();
    expect(client.seq).toBe(t.host.seq);
    expect(hashState(client.state)).toBe(hashState(t.host.state));
    expect(client.log).toEqual(t.host.log);
  });
});
