import { Injectable, computed, inject, signal } from '@angular/core';
import type { Subscription } from 'rxjs';
import { newId } from '../../core/db/deckfit-db';
import { SessionRepository } from '../../core/db/repositories';
import { IdentityService } from '../../core/identity/identity.service';
import { Clock } from '../../core/time/clock.service';
import type { EngineEvent } from '../../domain/engine/events';
import type { IntentInput } from '../../domain/engine/intents';
import type { GameState } from '../../domain/engine/state';
import type { GameStart, RoomRoutine } from '../../core/sync/net-message';
import type { Intensity } from '../../domain/models/schemas';
import { RoomGame, type RoomGameProblem } from '../../core/sync/room-game';
import { RoomSession, type LobbyView } from '../../core/sync/room-session';
import { SYNC_TRANSPORT_FACTORY } from '../../core/sync/sync.providers';
import { roomSessionRecord } from './session-record';
import { RoomStartService } from './room-start.service';

export interface RoomRejection {
  intent: string;
  reason: string;
  at: number;
}

/**
 * The device's current room connection and, once started, its game. Root-scoped so a room
 * created on /room/new survives the navigation to its lobby; the lobby leaves when closed.
 */
@Injectable({ providedIn: 'root' })
export class RoomService {
  private readonly transportFactory = inject(SYNC_TRANSPORT_FACTORY);
  private readonly identity = inject(IdentityService);
  private readonly starter = inject(RoomStartService);
  private readonly sessions = inject(SessionRepository);
  private readonly clock = inject(Clock);
  /** Events seen this game, for the saved Session log. */
  private log: EngineEvent[] = [];
  private startedAt = 0;
  private savedSessionId: string | null = null;
  /** Whether this game's GameOver has been handled (ready flags cleared, session saved). */
  private finished = false;
  private session: RoomSession | null = null;
  private game: RoomGame | null = null;
  private subs: Subscription[] = [];

  readonly view = signal<LobbyView | null>(null);
  readonly start = signal<GameStart | null>(null);
  readonly state = signal<GameState | null>(null);
  /** The latest step's events (as this player may see them). */
  readonly events = signal<readonly EngineEvent[]>([]);
  readonly rejection = signal<RoomRejection | null>(null);
  /** Why this device's game can't go on (hidden games: no secure context, or the host left). */
  readonly problem = signal<RoomGameProblem | null>(null);
  /** True while watching a game this device isn't playing in (it joined after the game began). */
  readonly spectating = signal(false);
  readonly me = signal<string | null>(null);
  readonly playing = computed(() => this.start() !== null && this.state() !== null);

  get code(): string | null {
    return this.session?.code ?? null;
  }

  async create(routine: RoomRoutine): Promise<string> {
    await this.leave();
    return this.attach(
      await RoomSession.host(this.transportFactory(), await this.identity.me(), routine),
    ).code;
  }

  /** Joins `code` unless already in it. Rejects when the room doesn't exist. */
  async join(code: string): Promise<void> {
    if (this.session?.code === code) return;
    await this.leave();
    this.attach(await RoomSession.join(this.transportFactory(), code, await this.identity.me()));
  }

  setReady(ready: boolean): void {
    this.session?.setReady(ready);
  }

  setRoutine(routine: RoomRoutine): void {
    this.session?.setRoutine(routine);
  }

  /** Host: how hard this room works (§6.1). Everyone re-readies, since the workload changed. */
  setIntensity(intensity: Intensity): void {
    const room = this.view()?.routine;
    if (!room) return;
    this.setRoutine({ ...room, routine: { ...room.routine, settings: { ...room.routine.settings, intensity } } });
  }

  async rename(name: string): Promise<void> {
    await this.identity.rename(name);
    this.session?.rename((await this.identity.me()).name);
  }

  /** Host: start the game for everyone. `seed` only for reproducible dev/e2e runs. */
  async startGame(seed?: number): Promise<void> {
    const session = this.session;
    const view = session?.snapshot;
    if (!session || !view?.routine) return;
    session.start(await this.starter.build(view.routine, view.players, seed));
  }

  /**
   * Host: deal the same routine again for everyone at the table, without a trip through the
   * lobby. Everyone present counts as in — including anyone who joined mid-game and watched.
   * Returns why it couldn't (too many players for the game, say), else null.
   */
  async rematch(): Promise<string | null> {
    const session = this.session;
    if (!session?.snapshot?.routine) return 'This room has no routine to replay.';
    try {
      session.readyAll();
      const view = session.snapshot;
      if (view.blocker) return view.blocker;
      session.start(await this.starter.build(view.routine!, view.players));
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Could not start another game.';
    }
  }

  /** Host: end the finished game and take everyone back to the lobby to pick something else. */
  endGame(): void {
    this.session?.endGame();
  }

  /** Player: tell the host you're up for another game (the lobby's ready flag). */
  wantRematch(): void {
    this.session?.setReady(true);
  }

  dispatch(intent: IntentInput): void {
    this.game?.dispatch(intent);
  }

  async leave(): Promise<void> {
    const session = this.session;
    this.session = null;
    this.game?.dispose();
    this.game = null;
    for (const s of this.subs.splice(0)) s.unsubscribe();
    this.view.set(null);
    this.start.set(null);
    this.state.set(null);
    this.events.set([]);
    this.rejection.set(null);
    this.problem.set(null);
    this.spectating.set(false);
    await session?.leave();
  }

  /**
   * Saves a finished room game to History, as this device's player (§10). Hidden games redact
   * other players' totals, so only your own work is complete in the record.
   */
  /** The room is back in the lobby: drop this device's game, keeping the connection. */
  private clearGame(): void {
    this.game?.dispose();
    this.game = null;
    this.start.set(null);
    this.state.set(null);
    this.events.set([]);
    this.rejection.set(null);
    this.problem.set(null);
    this.spectating.set(false);
  }

  private async saveSession(start: GameStart, state: GameState): Promise<void> {
    const me = this.me();
    if (state.phase !== 'finished' || this.savedSessionId || !me) return;
    this.savedSessionId = newId('session');
    const session = roomSessionRecord({
      id: this.savedSessionId,
      start,
      state,
      playerId: me,
      roomId: this.code,
      log: this.log,
      startedAt: this.startedAt || this.clock.epoch(),
      endedAt: this.clock.epoch(),
    });
    try {
      await this.sessions.save(session);
    } catch (err) {
      this.savedSessionId = null;
      console.warn('Could not save the room session', err);
    }
  }

  private attach(session: RoomSession): RoomSession {
    this.session = session;
    this.me.set(session.me.id);
    this.subs.push(session.view.subscribe((v) => this.view.set(v)));
    session.onEnd(() => this.clearGame());
    session.onStart((start, resumed) => {
      // A resumed copy arrives when this device joined mid-game; ignore it if we're already playing.
      if (resumed && this.game) return;
      this.game?.dispose();
      const game = new RoomGame(session, start, { resumed });
      this.game = game;
      this.start.set(start);
      this.spectating.set(game.spectator);
      this.log = [];
      this.startedAt = this.clock.epoch();
      this.savedSessionId = null;
      this.finished = false;
      this.subs.push(
        game.updates$.subscribe((u) => {
          this.state.set(u.state);
          if (u.events.length) {
            this.events.set(u.events);
            this.log.push(...u.events);
          }
          if (u.state.phase === 'finished' && !this.finished) {
            this.finished = true;
            // Nobody is "ready" for a game that's over: each player says again if they want another.
            this.session?.clearReady();
          }
          void this.saveSession(start, u.state);
        }),
        game.rejections$.subscribe((r) => this.rejection.set({ ...r, at: Date.now() })),
        game.problem$.subscribe((p) => this.problem.set(p)),
      );
    });
    return session;
  }
}
