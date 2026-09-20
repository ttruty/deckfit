import { firstValueFrom } from 'rxjs';
import { flush, intervalRoomRoutine, intervalStart, waitFor } from '../../../testing/sync';
import type { GameStart } from './net-message';
import { LoopbackHub, LoopbackTransport } from './loopback-transport';
import { RoomSession, type LobbyView } from './room-session';

const ann = { id: 'ann', name: 'Ann' };
const bo = { id: 'bo', name: 'Bo' };
const cy = { id: 'cy', name: 'Cy' };

async function threePeers() {
  const hub = new LoopbackHub();
  const host = await RoomSession.host(new LoopbackTransport(hub), ann, intervalRoomRoutine());
  const b = await RoomSession.join(new LoopbackTransport(hub), host.code, bo);
  const c = await RoomSession.join(new LoopbackTransport(hub), host.code, cy);
  await flush();
  return { hub, host, b, c, all: [host, b, c] };
}

const view = (s: RoomSession) => s.snapshot!;
const summary = (v: LobbyView) =>
  v.players.map((p) => `${p.name}${p.isHost ? '*' : ''}:${p.ready ? 'ready' : 'waiting'}`);

describe('RoomSession (3 loopback peers)', () => {
  it('everyone sees the same code, host, routine preview, and presence in seat order', async () => {
    const { host, all } = await threePeers();
    for (const s of all) {
      const v = view(s);
      expect(v.code).toBe(host.code);
      expect(v.hostId).toBe('ann');
      expect(v.routine?.routine.name).toBe('Tabata at the park');
      expect(v.routine?.preview).toMatchObject({
        gameName: 'Interval Deck',
        deckName: 'Bodyweight deck',
        players: { min: 1, max: 6 },
      });
      expect(v.players.map((p) => [p.name, p.seat, p.isHost])).toEqual([
        ['Ann', 0, true],
        ['Bo', 1, false],
        ['Cy', 2, false],
      ]);
      expect(v.players.filter((p) => p.isMe)).toHaveLength(1);
    }
    expect(view(host).isHost).toBe(true);
    expect(view(all[1]).isHost).toBe(false);
  });

  it('ready toggles propagate through the host, and the start blocker clears only when all are ready', async () => {
    const { host, b, c, all } = await threePeers();
    expect(view(host).blocker).toBe('Waiting for 3 players to be ready.');
    b.setReady(true);
    await flush();
    for (const s of all)
      expect(summary(view(s))).toEqual(['Ann*:waiting', 'Bo:ready', 'Cy:waiting']);
    host.setReady(true);
    c.setReady(true);
    await flush();
    for (const s of all) expect(view(s).blocker).toBeNull();
    c.setReady(false);
    await flush();
    expect(view(b).blocker).toBe('Waiting for 1 player to be ready.');
  });

  it('a player leaving drops their seat and ready flag; newcomers join not ready', async () => {
    const { hub, host, b, c } = await threePeers();
    c.setReady(true);
    await flush();
    await c.leave();
    await flush();
    expect(summary(view(host))).toEqual(['Ann*:waiting', 'Bo:waiting']);
    expect((await firstValueFrom(host.view))?.players.map((p) => p.id)).toEqual(['ann', 'bo']);
    const d = await RoomSession.join(new LoopbackTransport(hub), host.code, {
      id: 'di',
      name: 'Di',
    });
    await flush();
    expect(summary(view(b))).toEqual(['Ann*:waiting', 'Bo:waiting', 'Di:waiting']);
    expect(view(d).routine?.routine.id).toBe('routine-room');
  });

  it('rejoining with the same id keeps the seat', async () => {
    const { hub, host, b } = await threePeers();
    await RoomSession.join(new LoopbackTransport(hub), host.code, { ...bo, name: 'Bo again' });
    await flush();
    expect(view(host).players.map((p) => [p.name, p.seat])).toEqual([
      ['Ann', 0],
      ['Bo again', 1],
      ['Cy', 2],
    ]);
    expect(b.snapshot).not.toBeNull(); // the old connection simply stops receiving presence
  });

  it('renames show up in everyone’s presence', async () => {
    const { b, c } = await threePeers();
    b.rename('Bobby');
    await flush();
    expect(view(c).players.map((p) => p.name)).toEqual(['Ann', 'Bobby', 'Cy']);
  });

  it('changing the routine clears ready flags; only the host may change it or start', async () => {
    const { host, b, all } = await threePeers();
    for (const s of all) s.setReady(true);
    await flush();
    const next = intervalRoomRoutine();
    next.routine.name = 'Longer set';
    host.setRoutine(next);
    await flush();
    expect(view(b).routine?.routine.name).toBe('Longer set');
    expect(view(b).players.every((p) => !p.ready)).toBe(true);
    expect(() => b.setRoutine(next)).toThrow(/host/);
    expect(() => b.start(intervalStart([ann, bo, cy]))).toThrow(/host/);
    expect(() => host.start(intervalStart([ann, bo, cy]))).toThrow(/Waiting for 3/);
  });

  it('ignores room-state and start messages that do not come from the host', async () => {
    const { host, b, c } = await threePeers();
    // Same term and a later seat, then a "newer term" while the real host is still present: both ignored.
    const forged = {
      code: host.code,
      hostId: 'cy',
      epoch: 0,
      seats: ['ann', 'bo', 'cy'],
      phase: 'playing' as const,
      routine: null,
      ready: {},
    };
    c.transport.send({ kind: 'room-state', from: 'cy', state: forged });
    c.transport.send({ kind: 'room-state', from: 'cy', state: { ...forged, epoch: 7 } });
    const starts: GameStart[] = [];
    b.onStart((s) => starts.push(s));
    c.transport.send({ kind: 'start', from: 'cy', start: intervalStart([ann, bo, cy]) });
    await flush();
    expect(view(b).hostId).toBe('ann');
    expect(view(b).routine).not.toBeNull();
    expect(view(b).phase).toBe('lobby');
    expect(starts).toEqual([]);
  });

  it('enforces the game’s player range', async () => {
    const hub = new LoopbackHub();
    const routine = intervalRoomRoutine();
    routine.preview.players = { min: 2, max: 2 };
    const host = await RoomSession.host(new LoopbackTransport(hub), ann, routine);
    await flush();
    expect(view(host).blocker).toBe('Interval Deck needs at least 2 players.');
    await RoomSession.join(new LoopbackTransport(hub), host.code, bo);
    await RoomSession.join(new LoopbackTransport(hub), host.code, cy);
    await flush();
    expect(view(host).blocker).toBe('Interval Deck allows at most 2 players.');
  });

  it('host start reaches every peer with an identical payload, and the room enters playing', async () => {
    const { host, b, c, all } = await threePeers();
    for (const s of all) s.setReady(true);
    await flush();
    const received = Promise.all(
      [b, c].map((s) => new Promise<GameStart>((resolve) => s.onStart(resolve))),
    );
    const start = intervalStart(view(host).players.map(({ id, name }) => ({ id, name })));
    host.start(start);
    const [sb, sc] = await received;
    expect(sb).toEqual(start);
    expect(sc).toEqual(start);
    await waitFor(b.view, (v) => v?.phase === 'playing');
  });

  it('after a game the host can deal another one without a trip through the lobby', async () => {
    const { host, b, c, all } = await threePeers();
    for (const s of all) s.setReady(true);
    await flush();
    host.start(intervalStart(view(host).players.map(({ id, name }) => ({ id, name }))));
    await flush();

    // The game is over: nobody is "ready" for another until they say so.
    host.clearReady();
    await flush();
    for (const s of all)
      expect(summary(view(s))).toEqual(['Ann*:waiting', 'Bo:waiting', 'Cy:waiting']);
    b.setReady(true);
    await flush();
    expect(
      view(host)
        .players.filter((p) => p.ready)
        .map((p) => p.name),
    ).toEqual(['Bo']);

    // A rematch counts everyone at the table as in, so one tap deals again.
    const seconds = Promise.all(
      [b, c].map((s) => new Promise<GameStart>((resolve) => s.onStart(resolve))),
    );
    host.readyAll();
    await flush();
    expect(view(host).blocker).toBeNull();
    const again = intervalStart(
      view(host).players.map(({ id, name }) => ({ id, name })),
      99,
    );
    host.start(again);
    for (const s of await seconds) expect(s.seed).toBe(99);
    for (const s of all) expect(view(s).phase).toBe('playing');
  });

  it('ending the game puts everyone back in the lobby, un-ready, ready for another routine', async () => {
    const { host, b, c, all } = await threePeers();
    for (const s of all) s.setReady(true);
    await flush();
    host.start(intervalStart(view(host).players.map(({ id, name }) => ({ id, name }))));
    await flush();

    const ended = [b, c].map((s) => new Promise<void>((resolve) => s.onEnd(resolve)));
    let hostEnded = false;
    host.onEnd(() => (hostEnded = true));
    host.endGame();
    await Promise.all(ended);
    expect(hostEnded).toBe(true);
    for (const s of all) {
      expect(view(s).phase).toBe('lobby');
      expect(summary(view(s))).toEqual(['Ann*:waiting', 'Bo:waiting', 'Cy:waiting']);
    }
    // Only the host may end it, and ending twice is a no-op.
    expect(() => b.endGame()).toThrow(/host/);
    host.endGame();
    await flush();
    expect(view(c).phase).toBe('lobby');
  });

  it('joining a missing room fails', async () => {
    await expect(
      RoomSession.join(new LoopbackTransport(new LoopbackHub()), 'ZZZZZZ', bo),
    ).rejects.toThrow(/not found/);
  });
});
