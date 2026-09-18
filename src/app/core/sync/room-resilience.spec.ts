import { hashState } from '../../domain/engine/hash';
import { DelayedTransport, flush, intervalRoomRoutine, intervalStart } from '../../../testing/sync';
import { ClockSync } from './clock-sync';
import { GameClient } from './game-client';
import { GameHost, promoteToHost } from './game-host';
import { createGame } from './game-start';
import { LoopbackHub, LoopbackTransport } from './loopback-transport';
import { HOST_MIGRATION_MS, RoomSession } from './room-session';
import { ManualScheduler } from './scheduler';

const ann = { id: 'ann', name: 'Ann' };
const bo = { id: 'bo', name: 'Bo' };
const cy = { id: 'cy', name: 'Cy' };

/** Advances manual time in small steps, letting loopback microtasks run between steps. */
async function run(scheduler: ManualScheduler, ms: number, step = 5) {
  for (let t = 0; t < ms; t += step) {
    scheduler.advance(step);
    await flush(1);
  }
}

describe('clock offset measurement', () => {
  it('estimates a skewed client clock within half the round trip, preferring the fastest sample', async () => {
    const hub = new LoopbackHub();
    const hostClock = new ManualScheduler(0);
    const clientClock = new ManualScheduler(+4_321); // client is 4.321 s ahead
    clientClock.syncTo(hostClock);

    const hostT = new LoopbackTransport(hub);
    const { code } = await hostT.createRoom(ann);
    new ClockSync(hostT, 'ann', hostClock).start(() => true);

    const rawClient = new LoopbackTransport(hub);
    await rawClient.joinRoom(code, bo);
    // 40 ms each way, on a shared timeline.
    const client = new ClockSync(new DelayedTransport(rawClient, clientClock, 40), 'bo', clientClock);
    client.start(() => false);

    const measuring = client.measure('ann', { count: 5 });
    for (let i = 0; i < 100; i++) {
      clientClock.advance(5);
      hostClock.advance(5);
      await flush(1);
    }
    const est = await measuring;
    expect(est.samples).toBe(5);
    expect(est.rtt).toBe(40); // delay applies to the client's incoming side only
    expect(Math.abs(est.offset - -4_321)).toBeLessThanOrEqual(est.rtt / 2);
    expect(Math.abs(client.hostNow() - hostClock.now())).toBeLessThanOrEqual(20);
  });

  it('the host measures zero offset and a lost pong times out without breaking the estimate', async () => {
    const hub = new LoopbackHub();
    const clock = new ManualScheduler();
    const t = new LoopbackTransport(hub);
    await t.createRoom(ann);
    const sync = new ClockSync(t, 'ann', clock);
    expect(await sync.measure('ann')).toEqual({ offset: 0, rtt: 0, samples: 0 });

    const lonely = new LoopbackTransport(hub);
    await lonely.joinRoom([...hub.rooms.keys()][0], bo);
    const noHost = new ClockSync(lonely, 'bo', clock);
    noHost.start(() => false);
    const measuring = noHost.measure('nobody', { count: 2, timeoutMs: 100 });
    await run(clock, 250);
    expect(await measuring).toEqual({ offset: 0, rtt: Number.POSITIVE_INFINITY, samples: 0 });
  });

  it('room joiners measure their offset to the host automatically', async () => {
    const hub = new LoopbackHub();
    const host = await RoomSession.host(new LoopbackTransport(hub), ann, intervalRoomRoutine());
    const b = await RoomSession.join(new LoopbackTransport(hub), host.code, bo);
    await flush(30);
    expect(b.clockEstimate.samples).toBe(5);
    expect(Math.abs(b.clockEstimate.offset)).toBeLessThan(50); // same machine clock
  });
});

describe('rejoin by device id', () => {
  it('a player who leaves and comes back gets the same seat, ahead of later joiners', async () => {
    const hub = new LoopbackHub();
    const host = await RoomSession.host(new LoopbackTransport(hub), ann, intervalRoomRoutine(), { clockSamples: 0 });
    const b = await RoomSession.join(new LoopbackTransport(hub), host.code, bo, { clockSamples: 0 });
    await RoomSession.join(new LoopbackTransport(hub), host.code, cy, { clockSamples: 0 });
    await flush();
    await b.leave();
    await flush();
    expect(host.snapshot!.players.map((p) => p.id)).toEqual(['ann', 'cy']);
    await RoomSession.join(new LoopbackTransport(hub), host.code, { id: 'di', name: 'Di' }, { clockSamples: 0 });
    const back = await RoomSession.join(new LoopbackTransport(hub), host.code, { ...bo, name: 'Bo (phone 2)' }, { clockSamples: 0 });
    await flush();
    for (const s of [host, back]) {
      expect(s.snapshot!.players.map((p) => [p.id, p.seat])).toEqual([['ann', 0], ['bo', 1], ['cy', 2], ['di', 3]]);
    }
  });
});

describe('host migration', () => {
  async function room() {
    const hub = new LoopbackHub();
    const clock = new ManualScheduler();
    const opts = { scheduler: clock, clockSamples: 0 };
    const hostT = new LoopbackTransport(hub);
    const host = await RoomSession.host(hostT, ann, intervalRoomRoutine(), opts);
    const b = await RoomSession.join(new LoopbackTransport(hub), host.code, bo, opts);
    const c = await RoomSession.join(new LoopbackTransport(hub), host.code, cy, opts);
    await flush();
    b.setReady(true);
    await flush();
    return { hub, clock, opts, host, hostT, b, c };
  }

  it('after 10 s without the host, the earliest-seated player takes over; everyone agrees', async () => {
    const { clock, host, b, c } = await room();
    const changes: string[] = [];
    c.onHostChange((id, epoch) => changes.push(`${id}@${epoch}`));
    await host.leave();
    await flush();
    expect(b.snapshot!.hostAway).toBe(true);

    clock.advance(HOST_MIGRATION_MS - 1);
    await flush();
    expect(b.isHost).toBe(false);

    clock.advance(1);
    await flush();
    for (const s of [b, c]) {
      expect(s.snapshot).toMatchObject({ hostId: 'bo', epoch: 1, hostAway: false });
      expect(s.snapshot!.players.map((p) => [p.id, p.isHost])).toEqual([['bo', true], ['cy', false]]);
    }
    expect(b.isHost).toBe(true);
    expect(changes).toEqual(['bo@1']);
    // The new host now owns ready flags, and kept the one set before migration.
    c.setReady(true);
    await flush();
    expect(b.snapshot!.players.map((p) => p.ready)).toEqual([true, true]);
  });

  it('a brief host blip (under 10 s) changes nothing', async () => {
    const { hub, clock, opts, host, b, c } = await room();
    await host.leave();
    await flush();
    clock.advance(6_000);
    const back = await RoomSession.join(new LoopbackTransport(hub), host.code, ann, opts);
    await flush();
    clock.advance(20_000);
    await flush();
    for (const s of [b, c, back]) expect(s.snapshot).toMatchObject({ hostId: 'ann', epoch: 0, hostAway: false });
  });

  it('the old host, rejoining after migration, accepts the new host and keeps its seat', async () => {
    const { hub, clock, opts, host, b, c } = await room();
    await host.leave();
    await flush();
    clock.advance(HOST_MIGRATION_MS);
    await flush();
    const back = await RoomSession.join(new LoopbackTransport(hub), host.code, ann, opts);
    await flush();
    for (const s of [b, c, back]) {
      expect(s.snapshot).toMatchObject({ hostId: 'bo', epoch: 1 });
      expect(s.snapshot!.players.map((p) => p.id)).toEqual(['ann', 'bo', 'cy']);
    }
    expect(back.isHost).toBe(false);
  });

  it('a claim while the host is still present is ignored', async () => {
    const { host, b, c } = await room();
    // Cy is not the rightful successor (Bo is seated first) and Ann is present for everyone.
    c.transport.send({ kind: 'room-state', from: 'cy', state: { code: host.code, hostId: 'cy', epoch: 1, seats: ['ann', 'bo', 'cy'], phase: 'lobby', routine: null, ready: {} } });
    await flush();
    for (const s of [host, b]) expect(s.snapshot).toMatchObject({ hostId: 'ann', epoch: 0 });
  });

  it('a running game survives: the new host continues from its latest state and seq', async () => {
    const hub = new LoopbackHub();
    const start = intervalStart([ann, bo, cy]);
    const hostT = new LoopbackTransport(hub);
    const { code } = await hostT.createRoom(ann);
    const g = () => createGame(start);
    const host = new GameHost(hostT, g().ctx, g().initial);
    host.start();
    const peers = await Promise.all([bo, cy].map(async (p) => {
      const t = new LoopbackTransport(hub);
      await t.joinRoom(code, p);
      const game = g();
      const client = new GameClient(t, game.ctx, game.initial, p.id);
      client.start();
      return { t, client, ctx: game.ctx };
    }));
    hostT.send({ kind: 'intent', from: 'ann', intent: { type: 'deal', playerId: 'ann' } });
    await flush();
    hostT.send({ kind: 'intent', from: 'ann', intent: { type: 'flip', playerId: 'ann' } });
    await flush();
    const before = hashState(host.state);
    host.stop();
    await hostT.leave();

    // Bo is next in seat order: promote Bo's client; Cy keeps following.
    const [b, c] = peers;
    const newHost = promoteToHost(b.client, b.t, b.ctx);
    expect(hashState(newHost.state)).toBe(before);
    expect(newHost.seq).toBe(2);
    const boTask = newHost.state.tasks.find((t) => t.playerId === 'bo' && t.status === 'pending')!;
    b.t.send({ kind: 'intent', from: 'bo', intent: { type: 'completeTask', playerId: 'bo', taskId: boTask.id } });
    await flush();
    expect(newHost.seq).toBe(3);
    expect(c.client.seq).toBe(3);
    expect(hashState(c.client.state)).toBe(hashState(newHost.state));
  });
});

describe('presence lag', () => {
  it('a ready toggle that reaches the host before the player’s presence is applied once presence arrives', async () => {
    const hub = new LoopbackHub();
    const host = await RoomSession.host(new LoopbackTransport(hub), ann, intervalRoomRoutine(), { clockSamples: 0 });
    await flush();
    // Simulate Bo's ready arriving before Bo is in the host's presence.
    host.transport.send({ kind: 'ready', from: 'bo', ready: true });
    await flush();
    expect(host.snapshot!.players.map((p) => p.id)).toEqual(['ann']);
    await RoomSession.join(new LoopbackTransport(hub), host.code, bo, { clockSamples: 0 });
    await flush();
    expect(host.snapshot!.players.map((p) => `${p.id}:${p.ready}`)).toEqual(['ann:false', 'bo:true']);
  });
});
