import { BehaviorSubject, Subject, type Observable } from 'rxjs';
import type { EngineEvent } from '../../domain/engine/events';
import type { Intent, IntentInput } from '../../domain/engine/intents';
import { redactEvents, redactState } from '../../domain/engine/redact';
import type { EngineContext } from '../../domain/engine/reducer';
import type { GameState } from '../../domain/engine/state';
import { GameClient } from './game-client';
import { GameHost, promoteToHost } from './game-host';
import { createGame } from './game-start';
import type { GameStart } from './net-message';
import { PrivateLink } from './private-link';
import type { RoomSession } from './room-session';
import { realScheduler, type Scheduler } from './scheduler';
import { ViewClient } from './view-client';

export interface RoomGameUpdate {
  seq: number;
  state: GameState;
  events: readonly EngineEvent[];
}

export type RoomGameProblem = 'insecure-context' | 'host-left';

/** §7: how long a player may be missing from presence before the host drops them from the game. */
export const LEAVE_AFTER_MS = 20_000;

/**
 * One running game in a room, on this device (§7). The host runs a GameHost (with the game's
 * timing policy) and deals; everyone else runs a GameClient that stamps intents with the
 * host-corrected clock and asks for a snapshot on start (so the deal can't be missed).
 * If the room's host migrates to this device mid-game, its client is promoted to host.
 *
 * Hidden games (`game.hidden`): every device opens a PrivateLink. The host's GameHost sends each
 * player a redacted view privately; players run a ViewClient. Only the host knows the full state,
 * so a hidden game can't migrate: if the host changes, the game stops with problem 'host-left'.
 * Even on the host device, `updates$` carries only the host player's own redacted view.
 * Framework-free; RoomService wraps it for the UI.
 */
export class RoomGame {
  private host: GameHost | null = null;
  private client: GameClient | null = null;
  private viewer: ViewClient | null = null;
  private link: PrivateLink | null = null;
  /** On the host: the full (unredacted) state after the latest step. */
  private hostState: GameState;
  /** Host: pending "this player has been gone too long" timers, by player id. */
  private readonly absent = new Map<string, unknown>();
  private readonly ctx: EngineContext;
  private readonly updates: BehaviorSubject<RoomGameUpdate>;
  private readonly rejections = new Subject<{ intent: Intent['type']; reason: string }>();
  private readonly problems = new BehaviorSubject<RoomGameProblem | null>(null);
  private readonly unsubscribe: (() => void)[] = [];
  private readonly scheduler: Scheduler;
  readonly hidden: boolean;
  /** True when this device isn't one of the game's players: it joined after the game began. */
  readonly spectator: boolean;
  /** True when the game was already running when this device arrived (a late join, or a reload). */
  readonly resumed: boolean;

  constructor(
    private readonly session: RoomSession,
    readonly start: GameStart,
    opts: { scheduler?: Scheduler; resumed?: boolean } = {},
  ) {
    this.scheduler = opts.scheduler ?? realScheduler;
    this.resumed = opts.resumed === true;
    this.hidden = !!start.game.hidden;
    this.spectator = !start.players.some((p) => p.id === session.me.id);
    const { ctx, initial } = createGame(start);
    this.ctx = ctx;
    this.hostState = initial;
    this.updates = new BehaviorSubject<RoomGameUpdate>({ seq: 0, state: this.hidden ? redactState(initial, this.me) : initial, events: [] });
    const timing = start.game.timing ?? null;

    if (this.hidden) {
      if (!PrivateLink.supported()) {
        this.problems.next('insecure-context');
        return;
      }
      this.link = new PrivateLink(session.transport, session.me.id, session.code);
      this.link.start().catch(() => this.problems.next('insecure-context'));
    }

    // A device that arrived mid-game never deals: it follows the running game. If the room says
    // it's the host (it reloaded within the migration window), it takes the game back over as
    // soon as its client has a snapshot — hidden games can't, since only the old host had the
    // full state.
    if (this.resumed && session.isHost && this.hidden) {
      this.problems.next('host-left');
      return;
    }
    if (session.isHost && !this.resumed) {
      this.becomeHost(new GameHost(session.transport, ctx, initial, { timing, scheduler: this.scheduler, ...(this.link ? { privacy: this.link } : {}) }));
      this.dispatch({ type: 'deal' });
    } else if (this.link) {
      const viewer = new ViewClient(this.link, session.hostId, session.me.id, initial, () => session.hostNow());
      this.viewer = viewer;
      this.unsubscribe.push(viewer.onUpdate((u) => this.publish(u.seq, u.state, u.events)));
      viewer.start();
    } else {
      const client = new GameClient(session.transport, ctx, initial, session.me.id, () => session.hostNow());
      this.client = client;
      this.unsubscribe.push(client.onUpdate((u) => this.publish(u.seq, u.state, u.events)));
      client.start();
      client.requestSnapshot();
      if (this.resumed && session.isHost) {
        const promote = client.onUpdate(() => {
          promote();
          if (this.client !== client) return;
          this.client = null;
          this.becomeHost(promoteToHost(client, session.transport, this.ctx, { timing, scheduler: this.scheduler }));
        });
        this.unsubscribe.push(promote);
      }
    }

    this.unsubscribe.push(
      session.onHostChange((hostId) => {
        if (this.hidden) {
          if (hostId !== session.me.id || !this.host) this.halt();
          return;
        }
        if (hostId !== session.me.id || !this.client) return;
        const client = this.client;
        this.client = null;
        this.becomeHost(promoteToHost(client, session.transport, this.ctx, { timing, scheduler: this.scheduler }));
      }),
    );
  }

  get me(): string {
    return this.session.me.id;
  }

  get isHost(): boolean {
    return this.host !== null;
  }

  /** What this player sees (the full state in public games; their redacted view in hidden ones). */
  get state(): GameState {
    return this.updates.value.state;
  }

  get updates$(): Observable<RoomGameUpdate> {
    return this.updates.asObservable();
  }

  /** Set when the game can't go on (or can't start) on this device. */
  get problem$(): Observable<RoomGameProblem | null> {
    return this.problems.asObservable();
  }

  /** This player's rejected intents (e.g. a play that lost a timing conflict). */
  get rejections$(): Observable<{ intent: Intent['type']; reason: string }> {
    return this.rejections.asObservable();
  }

  /** Sends an intent as this player. On the host it goes through the same path as everyone else's. */
  dispatch(intent: IntentInput): void {
    if (this.problems.value || this.spectator) return;
    const own = { ...intent, playerId: this.me } as Intent;
    if (this.viewer) this.viewer.send(intent);
    else if (this.client) this.client.send(intent);
    else if (this.hidden) this.host?.submit(own, this.scheduler.now());
    else this.session.transport.send({ kind: 'intent', from: this.me, intent: own, sentAt: this.scheduler.now() });
  }

  dispose(): void {
    for (const u of this.unsubscribe.splice(0)) u();
    this.host?.stop();
    this.client?.stop();
    this.viewer?.stop();
    this.link?.stop();
  }

  private halt(): void {
    this.problems.next('host-left');
    this.viewer?.stop();
    this.link?.stop();
  }

  private becomeHost(host: GameHost): void {
    this.host = host;
    this.unsubscribe.push(
      host.onStep((s) => {
        const before = this.hostState;
        this.hostState = s.state;
        if (!this.hidden) return this.publish(s.seq, s.state, s.events);
        this.publish(s.seq, redactState(s.state, this.me), redactEvents(before, s.events, s.state, this.me));
      }),
    );
    host.start();
    this.watchForDropouts();
  }

  /**
   * §7 resilience: a player who is gone from presence for LEAVE_AFTER_MS is dropped from the game
   * (engine `leave`), so a simultaneous round or someone's turn can't wait on them forever. They
   * keep their seat in the room and can watch, but they're out of this game.
   */
  private watchForDropouts(): void {
    const sub = this.session.view.subscribe((view) => {
      if (!view || !this.host) return;
      const present = new Set(view.players.map((p) => p.id));
      const playing = this.hostState.turn.order.filter((id) => id !== this.me);
      for (const id of playing) {
        if (present.has(id)) {
          this.clearAbsence(id);
        } else if (!this.absent.has(id)) {
          this.absent.set(id, this.scheduler.setTimeout(() => this.dropIfStillAway(id), LEAVE_AFTER_MS));
        }
      }
      for (const id of [...this.absent.keys()]) if (!playing.includes(id)) this.clearAbsence(id);
    });
    this.unsubscribe.push(() => {
      sub.unsubscribe();
      for (const id of [...this.absent.keys()]) this.clearAbsence(id);
    });
  }

  private dropIfStillAway(playerId: string): void {
    this.absent.delete(playerId);
    const stillHere = this.session.snapshot?.players.some((p) => p.id === playerId) ?? false;
    if (stillHere || !this.host || this.hostState.phase !== 'playing' || !this.hostState.turn.order.includes(playerId)) return;
    this.host.submit({ type: 'leave', playerId });
  }

  private clearAbsence(playerId: string): void {
    const timer = this.absent.get(playerId);
    if (timer === undefined) return;
    this.scheduler.clearTimeout(timer);
    this.absent.delete(playerId);
  }

  private publish(seq: number, state: GameState, events: readonly EngineEvent[]): void {
    this.updates.next({ seq, state, events });
    for (const e of events) {
      if (e.type === 'IntentRejected' && e.playerId === this.me) this.rejections.next({ intent: e.intent, reason: e.reason });
    }
  }
}
