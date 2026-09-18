import type { Subscription } from 'rxjs';
import type { EngineEvent } from '../../domain/engine/events';
import { hashState } from '../../domain/engine/hash';
import type { Intent, IntentInput } from '../../domain/engine/intents';
import { reduce, type EngineContext } from '../../domain/engine/reducer';
import type { GameState } from '../../domain/engine/state';
import type { NetMessageOf } from './net-message';
import type { PlayerId, SyncTransport } from './sync-transport';

type Update = { seq: number; events: readonly EngineEvent[]; state: GameState; resynced: boolean };

/**
 * Client side of the host-authoritative loop (§7). Applies `events` messages strictly in
 * `seq` order by reducing the carried intent locally and checking `stateHash`.
 * - seq already applied → ignored (duplicate).
 * - seq ahead of the next expected → buffered, and a snapshot is requested (gap).
 * - hash mismatch → a snapshot is requested; the diverged step is not kept.
 * A snapshot replaces state, seq, and log, then any buffered newer steps are applied.
 * While a snapshot is pending, further requests are suppressed.
 */
export class GameClient {
  private sub: Subscription | null = null;
  private _state: GameState;
  private _seq = 0;
  private _log: EngineEvent[] = [];
  private readonly buffer = new Map<number, NetMessageOf<'events'>>();
  private awaitingSnapshot = false;
  private readonly listeners = new Set<(u: Update) => void>();
  /** Diagnostics: how often each recovery path ran. */
  readonly stats = { duplicates: 0, gaps: 0, mismatches: 0, snapshots: 0 };

  constructor(
    private readonly transport: SyncTransport,
    private readonly ctx: EngineContext,
    initial: GameState,
    private readonly me: PlayerId,
    /** Host-corrected clock (RoomSession.hostNow) used to stamp `sentAt` for timing conflicts. */
    private readonly hostNow?: () => number,
  ) {
    this._state = initial;
  }

  get state(): GameState {
    return this._state;
  }

  get seq(): number {
    return this._seq;
  }

  get log(): readonly EngineEvent[] {
    return this._log;
  }

  start(): void {
    this.sub ??= this.transport.messages$.subscribe((msg) => {
      if (msg.kind === 'events') this.onEvents(msg);
      if (msg.kind === 'snapshot') this.onSnapshot(msg);
    });
  }

  stop(): void {
    this.sub?.unsubscribe();
    this.sub = null;
  }

  onUpdate(listener: (u: Update) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Sends an intent as this player. The host decides; state changes arrive as events. */
  send(intent: IntentInput): void {
    this.transport.send({
      kind: 'intent', from: this.me, intent: { ...intent, playerId: this.me } as Intent,
      ...(this.hostNow ? { sentAt: this.hostNow() } : {}),
    });
  }

  /** Forces a resync from the host (e.g. after reconnecting). */
  requestSnapshot(): void {
    if (this.awaitingSnapshot) return;
    this.awaitingSnapshot = true;
    this.transport.send({ kind: 'snapshot-request', from: this.me });
  }

  private onEvents(msg: NetMessageOf<'events'>): void {
    if (msg.seq <= this._seq) {
      this.stats.duplicates++;
      return;
    }
    if (msg.seq > this._seq + 1 || this.awaitingSnapshot) {
      if (!this.awaitingSnapshot) this.stats.gaps++;
      this.buffer.set(msg.seq, msg);
      this.requestSnapshot();
      return;
    }
    const step = reduce(this._state, msg.intent, this.ctx);
    if (hashState(step.state) !== msg.stateHash) {
      this.stats.mismatches++;
      this.buffer.set(msg.seq, msg);
      this.requestSnapshot();
      return;
    }
    this.commit(msg.seq, msg.events, step.state, false);
    this.drainBuffer();
  }

  private onSnapshot(msg: NetMessageOf<'snapshot'>): void {
    if (!this.awaitingSnapshot && msg.seq <= this._seq) return;
    this.awaitingSnapshot = false;
    this.stats.snapshots++;
    this._log = [...msg.log];
    for (const seq of [...this.buffer.keys()]) if (seq <= msg.seq) this.buffer.delete(seq);
    this.commit(msg.seq, [], msg.state, true);
    this.drainBuffer();
  }

  private drainBuffer(): void {
    for (let next = this.buffer.get(this._seq + 1); next && !this.awaitingSnapshot; next = this.buffer.get(this._seq + 1)) {
      this.buffer.delete(next.seq);
      this.onEvents(next);
    }
  }

  private commit(seq: number, events: readonly EngineEvent[], state: GameState, resynced: boolean): void {
    this._seq = seq;
    this._state = state;
    if (!resynced) this._log.push(...events);
    for (const l of this.listeners) l({ seq, events, state, resynced });
  }
}
