import type { Subscription } from 'rxjs';
import type { NetMessageOf } from './net-message';
import { realScheduler, type Scheduler } from './scheduler';
import type { PlayerId, SyncTransport } from './sync-transport';

export interface ClockEstimate {
  /** Add to this device's clock to get the host's clock. */
  offset: number;
  /** Round-trip time of the sample the offset came from. */
  rtt: number;
  samples: number;
}

/**
 * Clock-offset measurement against the host (§7), NTP-style: the client sends ping(t0),
 * the host replies with its receive time t1, the client notes arrival t2.
 * offset = t1 − (t0 + t2) / 2, trusted most from the sample with the smallest round trip
 * (least asymmetric delay). Pings are sent one at a time; a lost pong times out.
 */
export class ClockSync {
  private sub: Subscription | null = null;
  private pending: { id: number; resolve: (s: { offset: number; rtt: number } | null) => void; timer: unknown } | null = null;
  private nextId = 1;
  private _estimate: ClockEstimate = { offset: 0, rtt: Number.POSITIVE_INFINITY, samples: 0 };

  constructor(
    private readonly transport: SyncTransport,
    private readonly me: PlayerId,
    private readonly scheduler: Scheduler = realScheduler,
  ) {}

  get estimate(): ClockEstimate {
    return this._estimate;
  }

  /** This device's best estimate of the host's current time. */
  hostNow(): number {
    return this.scheduler.now() + this._estimate.offset;
  }

  /** Listens for pings (answers when `isHost()`) and for pongs addressed to us. */
  start(isHost: () => boolean): void {
    this.sub ??= this.transport.messages$.subscribe((msg) => {
      if (msg.kind === 'ping' && isHost() && msg.from !== this.me) {
        this.transport.send({ kind: 'pong', from: this.me, id: msg.id, t0: msg.t0, t1: this.scheduler.now() }, msg.from);
      }
      if (msg.kind === 'pong') this.onPong(msg);
    });
  }

  stop(): void {
    this.sub?.unsubscribe();
    this.sub = null;
  }

  /** Measures against `hostId` with `count` sequential pings. The host itself has offset 0. */
  async measure(hostId: PlayerId, opts: { count?: number; timeoutMs?: number } = {}): Promise<ClockEstimate> {
    if (hostId === this.me) {
      this._estimate = { offset: 0, rtt: 0, samples: 0 };
      return this._estimate;
    }
    const count = opts.count ?? 5;
    let best: { offset: number; rtt: number } | null = null;
    let samples = 0;
    for (let i = 0; i < count; i++) {
      const sample = await this.ping(hostId, opts.timeoutMs ?? 2000);
      if (!sample) continue;
      samples++;
      if (!best || sample.rtt < best.rtt) best = sample;
    }
    if (best) this._estimate = { ...best, samples };
    return this._estimate;
  }

  private ping(hostId: PlayerId, timeoutMs: number): Promise<{ offset: number; rtt: number } | null> {
    return new Promise((resolve) => {
      const id = this.nextId++;
      const timer = this.scheduler.setTimeout(() => {
        if (this.pending?.id === id) this.pending = null;
        resolve(null);
      }, timeoutMs);
      this.pending = { id, resolve, timer };
      this.transport.send({ kind: 'ping', from: this.me, id, t0: this.scheduler.now() }, hostId);
    });
  }

  private onPong(msg: NetMessageOf<'pong'>): void {
    const p = this.pending;
    if (!p || p.id !== msg.id) return; // stale or not ours
    this.pending = null;
    this.scheduler.clearTimeout(p.timer);
    const t2 = this.scheduler.now();
    p.resolve({ offset: msg.t1 - (msg.t0 + t2) / 2, rtt: t2 - msg.t0 });
  }
}
