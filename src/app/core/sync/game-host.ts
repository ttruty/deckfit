import type { Subscription } from 'rxjs';
import type { EngineEvent } from '../../domain/engine/events';
import { hashState } from '../../domain/engine/hash';
import type { Intent, IntentType } from '../../domain/engine/intents';
import { reduce, type EngineContext } from '../../domain/engine/reducer';
import { redactEvents, redactState } from '../../domain/engine/redact';
import type { GameState } from '../../domain/engine/state';
import type { PrivateLink } from './private-link';
import { realScheduler, type Scheduler } from './scheduler';
import type { SyncTransport } from './sync-transport';

/** §7 timing-sensitive intents: held for `windowMs`, then applied by send time, then seat. */
export interface TimingPolicy {
  windowMs: number;
  intents: readonly IntentType[];
}

export interface HostStep {
  seq: number;
  intent: Intent;
  events: EngineEvent[];
  state: GameState;
}

/**
 * Host-authoritative engine runner (§7). Listens for `intent` messages, reduces them, and
 * broadcasts `{ seq, intent, events, stateHash }`. Answers `snapshot-request` with the full
 * state and log. Framework-free; hosts solo play and rooms alike.
 *
 * Trust: an intent is applied only if its `playerId` matches the message's `from`, so a
 * client cannot act for someone else. Spoofed intents are dropped (`spoofed` counts them).
 *
 * Timing conflicts (§7): intents listed in `timing` are not applied on arrival. The first one
 * opens a window of `windowMs`; everything that arrives in it is then applied in order of
 * `sentAt` (the sender's clock-offset-corrected time; arrival time if absent), ties broken by
 * lower seat. The engine then rejects whatever no longer applies (e.g. a card that no longer
 * fits the center), which clients show as "too late".
 *
 * Hidden games (`privacy` set, §7): nothing about the game goes on the public channel. Intents
 * arrive only over the PrivateLink (the sender is the key holder), and after every step each
 * player gets their own redacted view (redactState/redactEvents) privately. `view-request`
 * answers with the current view. The host's own intents go through `submit`.
 */
export class GameHost {
  private sub: Subscription | null = null;
  private _state: GameState;
  private _seq: number;
  private readonly _log: EngineEvent[];
  private readonly listeners = new Set<(step: HostStep) => void>();
  private readonly timing: TimingPolicy | null;
  private readonly scheduler: Scheduler;
  private batch: { intent: Intent; at: number; arrival: number }[] = [];
  private batchTimer: unknown = null;
  private readonly privacy: PrivateLink | null;
  private privateSub: Subscription | null = null;
  spoofed = 0;

  constructor(
    private readonly transport: SyncTransport,
    private readonly ctx: EngineContext,
    initial: GameState,
    opts: { seq?: number; log?: readonly EngineEvent[]; timing?: TimingPolicy | null; scheduler?: Scheduler; privacy?: PrivateLink } = {},
  ) {
    this.privacy = opts.privacy ?? null;
    this._state = initial;
    this._seq = opts.seq ?? 0;
    this._log = [...(opts.log ?? [])];
    this.timing = opts.timing ?? null;
    this.scheduler = opts.scheduler ?? realScheduler;
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
    if (this.privacy) {
      const link = this.privacy;
      this.privateSub ??= link.messages$.subscribe(({ from, msg }) => {
        const seated = this._state.players.some((p) => p.id === from);
        // Only players act; anyone in the room may ask for a view, and a spectator's shows
        // nothing but the public table (redactState hides every card they don't hold).
        if (msg.kind === 'intent' && seated) this.receiveIntent(from, msg.intent, msg.sentAt);
        if (msg.kind === 'view-request') this.sendView(from, this._state, []);
      });
      return;
    }
    this.sub ??= this.transport.messages$.subscribe((msg) => {
      if (msg.kind === 'intent') this.receiveIntent(msg.from, msg.intent, msg.sentAt);
      if (msg.kind === 'snapshot-request') {
        this.transport.send({ kind: 'snapshot', seq: this._seq, state: this._state, log: [...this._log] }, msg.from);
      }
    });
  }

  stop(): void {
    this.sub?.unsubscribe();
    this.sub = null;
    this.privateSub?.unsubscribe();
    this.privateSub = null;
    if (this.batchTimer !== null) this.scheduler.clearTimeout(this.batchTimer);
    this.batchTimer = null;
    this.batch = [];
  }

  /** Local observers (e.g. persistence) see every applied intent with the resulting state. */
  onStep(listener: (step: HostStep) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The host's own intent (hidden games, where there is no public intent path). Same timing rules. */
  submit(intent: Intent, sentAt?: number): void {
    this.receiveIntent(intent.playerId, intent, sentAt);
  }

  private receiveIntent(from: string, intent: Intent, sentAt: number | undefined): void {
    if (intent.playerId !== from) {
      this.spoofed++;
      return;
    }
    if (this.timing?.intents.includes(intent.type)) this.hold(intent, sentAt);
    else this.apply(intent);
  }

  private sendView(playerId: string, state: GameState, events: readonly EngineEvent[], before?: GameState): void {
    this.privacy!.send(playerId, {
      kind: 'view', seq: this._seq, state: redactState(state, playerId),
      events: before ? redactEvents(before, events, state, playerId) : [],
    });
  }

  private hold(intent: Intent, sentAt: number | undefined): void {
    const arrival = this.scheduler.now();
    this.batch.push({ intent, at: sentAt ?? arrival, arrival });
    this.batchTimer ??= this.scheduler.setTimeout(() => this.flushBatch(), this.timing!.windowMs);
  }

  /** Applies held intents: earliest corrected send time first, ties → lower seat, then arrival. */
  private flushBatch(): void {
    this.batchTimer = null;
    const seat = new Map(this._state.players.map((p) => [p.id, p.seat]));
    const batch = this.batch.splice(0).sort(
      (a, b) => a.at - b.at || (seat.get(a.intent.playerId) ?? 99) - (seat.get(b.intent.playerId) ?? 99) || a.arrival - b.arrival,
    );
    for (const { intent } of batch) this.apply(intent);
  }

  /** Applies one intent. Rejections are broadcast too (IntentRejected drives the UI toast). */
  apply(intent: Intent): HostStep {
    const before = this._state;
    const { state, events } = reduce(before, intent, this.ctx);
    this._state = state;
    this._seq++;
    this._log.push(...events);
    const step = { seq: this._seq, intent, events, state };
    if (this.privacy) {
      for (const p of state.players) if (p.id !== this.privacy.me) this.sendView(p.id, state, events, before);
    } else {
      this.transport.send({ kind: 'events', seq: this._seq, intent, events, stateHash: hashState(state) });
    }
    for (const l of this.listeners) l(step);
    return step;
  }
}

/**
 * Host migration for a running game (§7): a client becomes the host from its latest state,
 * continuing the same seq and log. Other clients keep their GameClient; any step they
 * missed is recovered through the normal gap → snapshot path.
 */
export function promoteToHost(
  client: { stop(): void; state: GameState; seq: number; log: readonly EngineEvent[] },
  transport: SyncTransport,
  ctx: EngineContext,
  opts: { timing?: TimingPolicy | null; scheduler?: Scheduler } = {},
): GameHost {
  client.stop();
  const host = new GameHost(transport, ctx, client.state, { seq: client.seq, log: client.log, ...opts });
  host.start();
  return host;
}

/** Rebuilds state by replaying intents (resume, resync). Returns the events so callers can verify the log. */
export function replay(initial: GameState, intents: readonly Intent[], ctx: EngineContext): { state: GameState; events: EngineEvent[] } {
  let state = initial;
  const events: EngineEvent[] = [];
  for (const intent of intents) {
    const step = reduce(state, intent, ctx);
    state = step.state;
    events.push(...step.events);
  }
  return { state, events };
}
