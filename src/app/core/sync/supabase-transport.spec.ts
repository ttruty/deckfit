import { firstValueFrom } from 'rxjs';
import { FakeRealtime } from '../../../testing/fake-realtime';
import { flush, intervalRoomRoutine } from '../../../testing/sync';
import type { NetMessage } from './net-message';
import { RoomSession } from './room-session';
import { SupabaseTransport } from './supabase-transport';

const ann = { id: 'ann', name: 'Ann' };
const bo = { id: 'bo', name: 'Bo' };
const cy = { id: 'cy', name: 'Cy' };

/** Short waits so "not found" and code probing resolve quickly. */
const fast = { joinTimeoutMs: 40, createProbeMs: 10 };

describe('SupabaseTransport (fake Realtime)', () => {
  it('creates a room, lets others join, and reports presence in join order', async () => {
    const rt = new FakeRealtime();
    const a = new SupabaseTransport(rt, fast);
    const { code, hostId } = await a.createRoom(ann);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(hostId).toBe('ann');

    const b = new SupabaseTransport(rt, fast);
    await new Promise((r) => setTimeout(r, 2)); // distinct "since" timestamps
    expect(await b.joinRoom(code, bo)).toEqual({ code, hostId: 'ann' });
    await flush();
    for (const t of [a, b]) {
      expect((await firstValueFrom(t.presence$)).map((p) => [p.id, p.seat, p.isHost])).toEqual([['ann', 0, true], ['bo', 1, false]]);
    }
  });

  it('joining an empty or unknown room fails and leaves the channel', async () => {
    const rt = new FakeRealtime();
    await expect(new SupabaseTransport(rt, fast).joinRoom('ZZZZZZ', bo)).rejects.toThrow('Room ZZZZZZ not found');
    expect(rt.members('deckfit:room:ZZZZZZ')).toEqual([]);
  });

  it('picks a different code when the first one is already in use', async () => {
    const rt = new FakeRealtime();
    const codes = ['AAAAAA', 'AAAAAA', 'BBBBBB'];
    let i = 0;
    const seq = () => { const c = codes[Math.min(i++, codes.length - 1)]; return c; };
    const randomFor = (code: () => string) => {
      let chars: string[] = [];
      return () => {
        if (!chars.length) chars = code().split('');
        return 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'.indexOf(chars.shift()!) / 32 + 1e-9;
      };
    };
    const first = new SupabaseTransport(rt, { ...fast, random: randomFor(() => 'AAAAAA') });
    expect((await first.createRoom(ann)).code).toBe('AAAAAA');
    const second = new SupabaseTransport(rt, { ...fast, random: randomFor(seq) });
    expect((await second.createRoom(bo)).code).toBe('BBBBBB');
  });

  it('broadcasts to everyone including the sender; `to` reaches only the addressee', async () => {
    const rt = new FakeRealtime();
    const [a, b, c] = [new SupabaseTransport(rt, fast), new SupabaseTransport(rt, fast), new SupabaseTransport(rt, fast)];
    const { code } = await a.createRoom(ann);
    await b.joinRoom(code, bo);
    await c.joinRoom(code, cy);
    const got = { a: [] as NetMessage[], b: [] as NetMessage[], c: [] as NetMessage[] };
    a.messages$.subscribe((m) => got.a.push(m));
    b.messages$.subscribe((m) => got.b.push(m));
    c.messages$.subscribe((m) => got.c.push(m));

    a.send({ kind: 'room-state-request', from: 'ann' });
    b.send({ kind: 'ready', from: 'bo', ready: true }, 'cy');
    await flush();
    expect([got.a.length, got.b.length, got.c.length]).toEqual([1, 1, 2]);
    expect(got.c[1]).toEqual({ kind: 'ready', from: 'bo', ready: true });
  });

  it('drops malformed envelopes and invalid messages', async () => {
    const rt = new FakeRealtime();
    const a = new SupabaseTransport(rt, fast);
    const { code } = await a.createRoom(ann);
    const got: NetMessage[] = [];
    a.messages$.subscribe((m) => got.push(m));
    rt.inject(`deckfit:room:${code}`, 'msg', 'not an envelope');
    rt.inject(`deckfit:room:${code}`, 'msg', { msg: { kind: 'ready', from: '', ready: 'yes' } });
    rt.inject(`deckfit:room:${code}`, 'msg', { msg: { kind: 'ready', from: 'x', ready: true } });
    await flush();
    expect(a.dropped).toBe(2);
    expect(got).toEqual([{ kind: 'ready', from: 'x', ready: true }]);
  });

  it('a device reconnecting with the same id replaces its presence entry; renames propagate', async () => {
    const rt = new FakeRealtime();
    const a = new SupabaseTransport(rt, fast);
    const { code } = await a.createRoom(ann);
    const b1 = new SupabaseTransport(rt, fast);
    await b1.joinRoom(code, bo);
    const b2 = new SupabaseTransport(rt, fast); // same device, new tab/connection before the old one timed out
    await b2.joinRoom(code, { ...bo, name: 'Bo (reloaded)' });
    await flush();
    expect((await firstValueFrom(a.presence$)).map((p) => p.name)).toEqual(['Ann', 'Bo (reloaded)']);
    b2.updatePlayer({ ...bo, name: 'Bobby' });
    await flush();
    expect((await firstValueFrom(a.presence$)).map((p) => p.name)).toEqual(['Ann', 'Bobby']);
    await b1.leave();
    await flush();
    expect((await firstValueFrom(a.presence$)).map((p) => p.name)).toEqual(['Ann', 'Bobby']);
  });

  it('runs the full room protocol (ready flags, routine, migration candidate) the same as loopback', async () => {
    const rt = new FakeRealtime();
    const host = await RoomSession.host(new SupabaseTransport(rt, fast), ann, intervalRoomRoutine(), { clockSamples: 0 });
    const b = await RoomSession.join(new SupabaseTransport(rt, fast), host.code, bo);
    const c = await RoomSession.join(new SupabaseTransport(rt, fast), host.code, cy, { clockSamples: 0 });
    await flush(20);
    b.setReady(true);
    await flush(10);
    for (const s of [host, b, c]) {
      expect(s.snapshot!.players.map((p) => `${p.name}:${p.ready}`)).toEqual(['Ann:false', 'Bo:true', 'Cy:false']);
      expect(s.snapshot!.routine?.routine.name).toBe('Tabata at the park');
    }
    expect(b.clockEstimate.samples).toBe(5);
    // Nothing private crosses the wire: every payload is a validated room message.
    expect(rt.wire.get(`deckfit:room:${host.code}`)!.every((p) => typeof p === 'object')).toBe(true);
  });
});
