import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { z } from 'zod';
import { NetMessageSchema, type NetMessage } from './net-message';
import { realScheduler, type Scheduler } from './scheduler';
import type { PlayerId, PlayerInfo, PlayerPresence, RoomInfo, SyncTransport } from './sync-transport';

// ── The slice of Supabase Realtime this transport uses (fakeable in tests) ──

export interface PresenceMeta {
  id: string;
  name: string;
  /** When this device first joined the channel (its own clock). */
  since: number;
  /** True for the device that created the room. Authority lives in RoomState, not here. */
  creator: boolean;
}

export type SubscribeStatus = 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR';

export interface ChannelLike {
  onBroadcast(event: string, cb: (payload: unknown) => void): void;
  onPresenceSync(cb: () => void): void;
  subscribe(cb: (status: SubscribeStatus, err?: Error) => void): void;
  track(meta: PresenceMeta): Promise<unknown>;
  untrack(): Promise<unknown>;
  send(event: string, payload: unknown): Promise<unknown>;
  /** presence key (player id) → metas (one per connection with that key). */
  presenceState(): Record<string, unknown[]>;
}

export interface RealtimeLike {
  channel(topic: string, presenceKey: string): ChannelLike;
  removeChannel(channel: ChannelLike): Promise<unknown>;
}

/** Adapts a supabase-js client. Realtime broadcast + presence on public channels. */
export function supabaseRealtime(client: SupabaseClient): RealtimeLike {
  const wrapped = new WeakMap<ChannelLike, RealtimeChannel>();
  return {
    channel(topic, presenceKey) {
      const ch = client.channel(topic, { config: { broadcast: { self: true, ack: false }, presence: { key: presenceKey } } });
      const like: ChannelLike = {
        onBroadcast: (event, cb) => void ch.on('broadcast', { event }, (m: { payload: unknown }) => cb(m.payload)),
        onPresenceSync: (cb) => void ch.on('presence', { event: 'sync' }, () => cb()),
        subscribe: (cb) => void ch.subscribe((status, err) => cb(status as SubscribeStatus, err)),
        track: (meta) => ch.track({ ...meta }),
        untrack: () => ch.untrack(),
        send: (event, payload) => ch.send({ type: 'broadcast', event, payload }),
        presenceState: () => ch.presenceState() as Record<string, unknown[]>,
      };
      wrapped.set(like, ch);
      return like;
    },
    removeChannel: (like) => {
      const ch = wrapped.get(like);
      return ch ? client.removeChannel(ch) : Promise.resolve();
    },
  };
}

// ── Transport ───────────────────────────────────────────────────────────────

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const EVENT = 'msg';
const MetaSchema = z.object({ id: z.string().min(1), name: z.string().min(1), since: z.number(), creator: z.boolean() });
const EnvelopeSchema = z.object({ to: z.string().min(1).optional(), msg: z.unknown() });

export interface SupabaseTransportOptions {
  scheduler?: Scheduler;
  /** How long a joiner waits to see someone in the room before "not found". */
  joinTimeoutMs?: number;
  /** How long a creator watches a fresh code for existing members before using it. */
  createProbeMs?: number;
  random?: () => number;
}

/**
 * SyncTransport over Supabase Realtime (§7): one public channel per room, `deckfit:room:<CODE>`.
 * - Presence (keyed by player/device id) → presence$. A device that reconnects with the same id
 *   replaces its old presence entry; seats in the lobby come from RoomState, not from here.
 * - Broadcast event `msg` carries `{ to?, msg }`; everyone receives it (self included) and
 *   drops envelopes addressed to someone else. Every msg is Zod-validated on receipt.
 * - Public channels are readable by anyone who knows the code: private data travels only as
 *   PrivateLink ciphertext (§7 privacy).
 * All vendor code stays in this file.
 */
export class SupabaseTransport implements SyncTransport {
  private readonly incoming = new Subject<NetMessage>();
  private readonly presence = new BehaviorSubject<PlayerPresence[]>([]);
  private readonly presenceSync = new Subject<void>();
  private channel: ChannelLike | null = null;
  private me: PlayerInfo | null = null;
  private meta: PresenceMeta | null = null;
  private readonly scheduler: Scheduler;
  private readonly joinTimeoutMs: number;
  private readonly createProbeMs: number;
  private readonly random: () => number;
  dropped = 0;

  readonly messages$: Observable<NetMessage> = this.incoming.asObservable();
  readonly presence$: Observable<PlayerPresence[]> = this.presence.asObservable();

  constructor(private readonly realtime: RealtimeLike, opts: SupabaseTransportOptions = {}) {
    this.scheduler = opts.scheduler ?? realScheduler;
    this.joinTimeoutMs = opts.joinTimeoutMs ?? 4000;
    this.createProbeMs = opts.createProbeMs ?? 1200;
    this.random = opts.random ?? Math.random;
  }

  async createRoom(host: PlayerInfo): Promise<RoomInfo> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = Array.from({ length: 6 }, () => CODE_ALPHABET[Math.floor(this.random() * CODE_ALPHABET.length)]).join('');
      await this.connect(code, host, true);
      const occupied = await this.waitForOthers(this.createProbeMs);
      if (!occupied) return { code, hostId: host.id };
      await this.leave(); // someone is already using this code
    }
    throw new Error('Could not find a free room code');
  }

  async joinRoom(code: string, player: PlayerInfo): Promise<RoomInfo> {
    if (this.channel) await this.leave();
    await this.connect(code, player, false);
    if (!(await this.waitForOthers(this.joinTimeoutMs))) {
      await this.leave();
      throw new Error(`Room ${code} not found`);
    }
    const others = this.readPresence().filter((p) => p.id !== player.id);
    const host = others.find((p) => p.creator) ?? others[0];
    return { code, hostId: host.id };
  }

  send(msg: NetMessage, to?: PlayerId): void {
    if (!this.channel) throw new Error('Not in a room');
    void this.channel.send(EVENT, to ? { to, msg } : { msg }).catch(() => undefined);
  }

  updatePlayer(player: PlayerInfo): void {
    if (!this.channel || !this.meta) throw new Error('Not in a room');
    if (player.id !== this.meta.id) throw new Error('Cannot update another player');
    this.me = player;
    this.meta = { ...this.meta, name: player.name };
    void this.channel.track(this.meta);
  }

  async leave(): Promise<void> {
    const ch = this.channel;
    this.channel = null;
    this.meta = null;
    this.presence.next([]);
    if (!ch) return;
    await ch.untrack().catch(() => undefined);
    await this.realtime.removeChannel(ch).catch(() => undefined);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async connect(code: string, player: PlayerInfo, creator: boolean): Promise<void> {
    const ch = this.realtime.channel(`deckfit:room:${code}`, player.id);
    ch.onBroadcast(EVENT, (payload) => this.receive(payload));
    ch.onPresenceSync(() => {
      this.presence.next(this.readPresence().map(({ creator: isCreator, ...p }, seat) => ({ ...p, seat, isHost: isCreator, online: true })));
      this.presenceSync.next();
    });
    await new Promise<void>((resolve, reject) => {
      ch.subscribe((status, err) => {
        if (status === 'SUBSCRIBED') resolve();
        else if (status !== 'CLOSED') reject(err ?? new Error(`Realtime ${status}`));
      });
    });
    this.channel = ch;
    this.me = player;
    this.meta = { id: player.id, name: player.name, since: this.scheduler.now(), creator };
    await ch.track(this.meta);
  }

  /** Current presence: one entry per id (the newest connection), ordered by first-seen time. */
  private readPresence(): (PresenceMeta & { name: string })[] {
    const state = this.channel?.presenceState() ?? {};
    return Object.values(state)
      // Newest connection wins; on equal timestamps, the later entry (presence appends new connections).
      .map((metas) =>
        metas
          .map((m) => MetaSchema.safeParse(m))
          .flatMap((r) => (r.success ? [r.data] : []))
          .reduce<PresenceMeta | undefined>((best, m) => (!best || m.since >= best.since ? m : best), undefined),
      )
      .filter((m): m is PresenceMeta => !!m)
      .sort((a, b) => a.since - b.since || a.id.localeCompare(b.id));
  }

  /** Resolves true once presence shows anyone but us, false after `ms`. */
  private waitForOthers(ms: number): Promise<boolean> {
    const hasOthers = () => this.readPresence().some((p) => p.id !== this.me?.id);
    if (hasOthers()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const sub = this.presenceSync.subscribe(() => {
        if (!hasOthers()) return;
        sub.unsubscribe();
        this.scheduler.clearTimeout(timer);
        resolve(true);
      });
      const timer = this.scheduler.setTimeout(() => {
        sub.unsubscribe();
        resolve(hasOthers());
      }, ms);
    });
  }

  private receive(payload: unknown): void {
    if (!this.channel) return;
    const envelope = EnvelopeSchema.safeParse(payload);
    if (!envelope.success) {
      this.dropped++;
      return;
    }
    if (envelope.data.to && envelope.data.to !== this.me?.id) return;
    const parsed = NetMessageSchema.safeParse(envelope.data.msg);
    if (!parsed.success) {
      this.dropped++;
      return;
    }
    this.incoming.next(parsed.data);
  }
}
