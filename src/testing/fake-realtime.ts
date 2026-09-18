import type { ChannelLike, PresenceMeta, RealtimeLike, SubscribeStatus } from '../app/core/sync/supabase-transport';

/**
 * In-memory stand-in for Supabase Realtime public channels: broadcast (self included) and
 * presence keyed by a per-connection key, with async delivery like the real service.
 * One FakeRealtime = one project; every transport built on it shares the topics.
 */
export class FakeRealtime implements RealtimeLike {
  private readonly topics = new Map<string, Set<FakeChannel>>();
  /** Raw payloads seen on each topic, for inspection. */
  readonly wire = new Map<string, unknown[]>();

  channel(topic: string, presenceKey: string): ChannelLike {
    return new FakeChannel(this, topic, presenceKey);
  }

  async removeChannel(channel: ChannelLike): Promise<unknown> {
    (channel as FakeChannel).close();
    return 'ok';
  }

  /** Test hook: inject a raw broadcast on a topic (e.g. malformed payloads). */
  inject(topic: string, event: string, payload: unknown): void {
    for (const ch of this.members(topic)) queueMicrotask(() => ch.deliver(event, payload));
  }

  join(ch: FakeChannel): void {
    const set = this.topics.get(ch.topic) ?? new Set();
    set.add(ch);
    this.topics.set(ch.topic, set);
  }

  leave(ch: FakeChannel): void {
    this.topics.get(ch.topic)?.delete(ch);
    this.syncPresence(ch.topic);
  }

  members(topic: string): FakeChannel[] {
    return [...(this.topics.get(topic) ?? [])];
  }

  broadcast(topic: string, event: string, payload: unknown): void {
    const wire = JSON.parse(JSON.stringify(payload)) as unknown;
    this.wire.set(topic, [...(this.wire.get(topic) ?? []), wire]);
    for (const ch of this.members(topic)) queueMicrotask(() => ch.deliver(event, wire));
  }

  syncPresence(topic: string): void {
    for (const ch of this.members(topic)) queueMicrotask(() => ch.presenceSynced());
  }

  presenceState(topic: string): Record<string, unknown[]> {
    const state: Record<string, unknown[]> = {};
    for (const ch of this.members(topic)) {
      if (!ch.meta) continue;
      (state[ch.presenceKey] ??= []).push({ ...ch.meta, presence_ref: ch.ref });
    }
    return state;
  }
}

let refs = 0;

class FakeChannel implements ChannelLike {
  meta: PresenceMeta | null = null;
  readonly ref = `ref-${++refs}`;
  private readonly broadcastHandlers = new Map<string, ((p: unknown) => void)[]>();
  private readonly syncHandlers: (() => void)[] = [];
  private open = false;

  constructor(private readonly rt: FakeRealtime, readonly topic: string, readonly presenceKey: string) {}

  onBroadcast(event: string, cb: (payload: unknown) => void): void {
    this.broadcastHandlers.set(event, [...(this.broadcastHandlers.get(event) ?? []), cb]);
  }

  onPresenceSync(cb: () => void): void {
    this.syncHandlers.push(cb);
  }

  subscribe(cb: (status: SubscribeStatus, err?: Error) => void): void {
    this.open = true;
    this.rt.join(this);
    queueMicrotask(() => {
      cb('SUBSCRIBED');
      this.presenceSynced();
    });
  }

  async track(meta: PresenceMeta): Promise<unknown> {
    this.meta = { ...meta };
    this.rt.syncPresence(this.topic);
    return 'ok';
  }

  async untrack(): Promise<unknown> {
    this.meta = null;
    this.rt.syncPresence(this.topic);
    return 'ok';
  }

  async send(event: string, payload: unknown): Promise<unknown> {
    if (!this.open) throw new Error('channel closed');
    this.rt.broadcast(this.topic, event, payload);
    return 'ok';
  }

  presenceState(): Record<string, unknown[]> {
    return this.rt.presenceState(this.topic);
  }

  close(): void {
    this.open = false;
    this.meta = null;
    this.rt.leave(this);
  }

  deliver(event: string, payload: unknown): void {
    if (this.open) for (const h of this.broadcastHandlers.get(event) ?? []) h(payload);
  }

  presenceSynced(): void {
    if (this.open) for (const h of this.syncHandlers) h();
  }
}
