import type { Subscription } from 'rxjs';
import type { EngineEvent } from '../../domain/engine/events';
import type { Intent, IntentInput } from '../../domain/engine/intents';
import { redactState } from '../../domain/engine/redact';
import type { GameState } from '../../domain/engine/state';
import type { PrivateLink } from './private-link';
import type { PlayerId } from './sync-transport';

type Update = { seq: number; events: readonly EngineEvent[]; state: GameState; resynced: boolean };

/**
 * Client side of a hidden game (§7). It never runs the engine (it couldn't: it doesn't know the
 * deck order); it shows the redacted views the host sends it privately. Views are whole states,
 * so a lost one is repaired by the next: an older `seq` is ignored, a repeat of the current one
 * (a view-request answer) replaces the state without replaying events. Intents go privately to
 * the host. A view is requested whenever the host's key becomes known (start, host reload).
 */
export class ViewClient {
  private readonly subs: Subscription[] = [];
  private _state: GameState;
  private _seq = -1;
  private readonly _log: EngineEvent[] = [];
  private readonly listeners = new Set<(u: Update) => void>();

  constructor(
    private readonly link: PrivateLink,
    private readonly hostId: PlayerId,
    private readonly me: PlayerId,
    initial: GameState,
    private readonly hostNow?: () => number,
  ) {
    this._state = redactState(initial, me);
  }

  get state(): GameState {
    return this._state;
  }

  get seq(): number {
    return Math.max(this._seq, 0);
  }

  get log(): readonly EngineEvent[] {
    return this._log;
  }

  start(): void {
    if (this.subs.length) return;
    this.subs.push(
      this.link.messages$.subscribe(({ from, msg }) => {
        if (from !== this.hostId || msg.kind !== 'view' || msg.seq < this._seq) return;
        const resynced = msg.seq === this._seq;
        const events = resynced ? [] : msg.events;
        this._seq = msg.seq;
        this._state = msg.state;
        this._log.push(...events);
        for (const l of this.listeners) l({ seq: msg.seq, events, state: msg.state, resynced });
      }),
      this.link.peerKeys$.subscribe((id) => {
        if (id === this.hostId) this.requestView();
      }),
    );
    if (this.link.hasKey(this.hostId)) this.requestView();
  }

  stop(): void {
    for (const s of this.subs.splice(0)) s.unsubscribe();
  }

  onUpdate(listener: (u: Update) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(intent: IntentInput): void {
    this.link.send(this.hostId, {
      kind: 'intent', intent: { ...intent, playerId: this.me } as Intent, ...(this.hostNow ? { sentAt: this.hostNow() } : {}),
    });
  }

  requestView(): void {
    this.link.send(this.hostId, { kind: 'view-request' });
  }
}
