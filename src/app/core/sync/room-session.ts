import { BehaviorSubject, type Observable, type Subscription } from 'rxjs';
import { ClockSync, type ClockEstimate } from './clock-sync';
import type { GameStart, NetMessage, RoomRoutine, RoomState } from './net-message';
import { realScheduler, type Scheduler } from './scheduler';
import type { PlayerId, PlayerInfo, PlayerPresence, SyncTransport } from './sync-transport';
import { seatName } from '../identity/player-name';

/** §7: the host must be gone this long before someone else takes over. */
export const HOST_MIGRATION_MS = 10_000;

export interface LobbyPlayer extends PlayerPresence {
  ready: boolean;
  isMe: boolean;
}

export interface LobbyView {
  code: string;
  hostId: PlayerId;
  isHost: boolean;
  epoch: number;
  phase: RoomState['phase'];
  routine: RoomRoutine | null;
  /** Present players in room seat order (`seat` = index in this list). */
  players: LobbyPlayer[];
  /** Why the host can't start yet, or null when everyone is ready and the count fits. */
  blocker: string | null;
  /** Whether the host is currently absent (migration countdown running). */
  hostAway: boolean;
}

export interface RoomSessionOptions {
  scheduler?: Scheduler;
  /** Pings sent to measure the clock offset on join (0 disables). */
  clockSamples?: number;
}

/**
 * Lobby protocol over a SyncTransport (§7), identical for every transport.
 *
 * - The host owns RoomState and rebroadcasts it on every change. A peer accepts room-state
 *   only from the player it names as host, and only for the same or a newer `epoch`.
 * - Seats: `seats` lists ids in first-join order and never drops them, so a device that
 *   rejoins (same id) keeps its seat. Displayed seats are positions among present players.
 * - Host migration: when the host is missing from presence for HOST_MIGRATION_MS, the
 *   earliest-seated present player claims the room with epoch + 1. Peers compute the same
 *   candidate from shared state; if two claim at once, the higher epoch (then earlier
 *   seat) wins. A newer epoch is accepted only while the old host is absent (or by the old
 *   host itself, which then becomes a peer). Senders are self-declared on public channels,
 *   so this resists accidents and stale hosts, not a deliberate forger.
 * - Clock sync: non-hosts measure their offset to the host on join and after migration.
 */
export class RoomSession {
  private readonly subs: Subscription[] = [];
  private presence: PlayerPresence[] = [];
  private room: RoomState;
  private readonly view$ = new BehaviorSubject<LobbyView | null>(null);
  private readonly startListeners = new Set<(start: GameStart, resumed: boolean) => void>();
  private readonly endListeners = new Set<() => void>();
  private readonly hostListeners = new Set<(hostId: PlayerId, epoch: number) => void>();
  private migrationTimer: unknown = null;
  /** Ready flags from players the host can't see in presence yet (presence may lag broadcast). */
  private readonly earlyReady = new Map<PlayerId, boolean>();
  private readonly scheduler: Scheduler;
  private readonly clockSamples: number;
  readonly clock: ClockSync;
  private _me: PlayerInfo;
  private closed = false;
  /** The unredacted start payload this device sent as host. */
  private ownStart: GameStart | null = null;

  private constructor(
    readonly transport: SyncTransport,
    me: PlayerInfo,
    code: string,
    hostId: PlayerId,
    routine: RoomRoutine | null,
    known: boolean,
    opts: RoomSessionOptions,
  ) {
    this._me = me;
    this.scheduler = opts.scheduler ?? realScheduler;
    this.clockSamples = opts.clockSamples ?? 5;
    this.clock = new ClockSync(transport, me.id, this.scheduler);
    this.room = {
      code,
      hostId,
      routine,
      phase: 'lobby',
      // A joiner's epoch starts below any real one so the first room-state is accepted.
      epoch: known ? 0 : -1,
      seats: known ? [me.id] : [],
      ready: known ? { [me.id]: false } : {},
    };
  }

  /** Creates a room with this player as host. */
  static async host(
    transport: SyncTransport,
    me: PlayerInfo,
    routine: RoomRoutine | null,
    opts: RoomSessionOptions = {},
  ): Promise<RoomSession> {
    const info = await transport.createRoom(me);
    const session = new RoomSession(transport, me, info.code, info.hostId, routine, true, opts);
    session.listen();
    session.publish();
    return session;
  }

  /** Joins an existing room (also a rejoin, with the same player id); rejects if it doesn't exist. */
  static async join(
    transport: SyncTransport,
    code: string,
    me: PlayerInfo,
    opts: RoomSessionOptions = {},
  ): Promise<RoomSession> {
    const info = await transport.joinRoom(code, me);
    const session = new RoomSession(transport, me, info.code, info.hostId, null, false, opts);
    session.listen();
    transport.send({ kind: 'room-state-request', from: me.id });
    return session;
  }

  get code(): string {
    return this.room.code;
  }

  get me(): PlayerInfo {
    return this._me;
  }

  get isHost(): boolean {
    return this.room.hostId === this._me.id;
  }

  get hostId(): PlayerId {
    return this.room.hostId;
  }

  get view(): Observable<LobbyView | null> {
    return this.view$.asObservable();
  }

  get snapshot(): LobbyView | null {
    return this.view$.value;
  }

  get clockEstimate(): ClockEstimate {
    return this.clock.estimate;
  }

  /** Host's clock as estimated here (use to stamp timing-sensitive intents). */
  hostNow(): number {
    return this.clock.hostNow();
  }

  setReady(ready: boolean): void {
    if (this.isHost) {
      this.room = { ...this.room, ready: { ...this.room.ready, [this._me.id]: ready } };
      this.publish();
    } else {
      this.transport.send({ kind: 'ready', from: this._me.id, ready });
    }
  }

  /** Host only: changing the routine clears everyone's ready flag (they agreed to something else). */
  setRoutine(routine: RoomRoutine): void {
    if (!this.isHost) throw new Error('Only the host can change the routine');
    this.room = {
      ...this.room,
      routine,
      ready: this.allReady(false),
    };
    this.publish();
  }

  rename(name: string): void {
    this._me = { ...this._me, name };
    this.transport.updatePlayer(this._me);
  }

  /**
   * Host only: broadcasts the start payload once `blocker` is null. For hidden games the public
   * payload carries seed 0: with the real seed anyone could replay the shuffle and see every
   * hand. The host keeps the real payload for its own game.
   */
  start(start: GameStart): void {
    if (!this.isHost) throw new Error('Only the host can start');
    const blocker = this.snapshot?.blocker;
    if (blocker) throw new Error(blocker);
    this.room = { ...this.room, phase: 'playing' };
    this.publish();
    this.ownStart = start;
    this.transport.send({ kind: 'start', from: this._me.id, start: publicStart(start) });
  }

  /**
   * Host only: the game is over — everyone goes back to the lobby, where the host can pick
   * another routine. Ready flags clear, so each player says again that they're in (§7 rematch).
   */
  endGame(): void {
    if (!this.isHost) throw new Error('Only the host can end the game');
    if (this.room.phase !== 'playing') return;
    this.ownStart = null;
    this.room = { ...this.room, phase: 'lobby', ready: this.allReady(false) };
    this.publish();
    this.fireEnd();
  }

  /** Host only: everyone present is in for the next game — how a one-tap rematch skips the lobby. */
  readyAll(): void {
    if (!this.isHost) throw new Error('Only the host can start');
    this.room = { ...this.room, ready: this.allReady(true) };
    this.publish();
  }

  /** Host only: drop every ready flag without leaving the game (a finished game asks again). */
  clearReady(): void {
    if (!this.isHost) return;
    this.room = { ...this.room, ready: this.allReady(false) };
    this.publish();
  }

  /** `resumed` is true when the game was already running when this device arrived. */
  onStart(listener: (start: GameStart, resumed: boolean) => void): () => void {
    this.startListeners.add(listener);
    return () => this.startListeners.delete(listener);
  }

  /** Fires when the room goes back to the lobby after a game (the host ended it). */
  onEnd(listener: () => void): () => void {
    this.endListeners.add(listener);
    return () => this.endListeners.delete(listener);
  }

  /** Fires when the host changes (migration or a returning claimant with a newer epoch). */
  onHostChange(listener: (hostId: PlayerId, epoch: number) => void): () => void {
    this.hostListeners.add(listener);
    return () => this.hostListeners.delete(listener);
  }

  async leave(): Promise<void> {
    this.closed = true;
    this.cancelMigration();
    this.clock.stop();
    for (const s of this.subs) s.unsubscribe();
    this.subs.length = 0;
    this.view$.next(null);
    await this.transport.leave();
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private listen(): void {
    this.clock.start(() => this.isHost);
    this.subs.push(
      this.transport.presence$.subscribe((list) => this.onPresence(list)),
      this.transport.messages$.subscribe((msg) => this.onMessage(msg)),
    );
  }

  private onPresence(list: PlayerPresence[]): void {
    this.presence = list;
    if (this.isHost) {
      const seats = [
        ...this.room.seats,
        ...list.map((p) => p.id).filter((id) => !this.room.seats.includes(id)),
      ];
      const ready = Object.fromEntries(
        list.map((p) => [p.id, this.earlyReady.get(p.id) ?? this.room.ready[p.id] ?? false]),
      );
      for (const p of list) this.earlyReady.delete(p.id);
      this.room = { ...this.room, seats, ready };
      this.publish();
    } else {
      this.emit();
    }
    this.watchHost();
  }

  private onMessage(msg: NetMessage): void {
    switch (msg.kind) {
      case 'room-state-request':
        // The host answers everyone. Peers also answer the host itself when it rejoins
        // (e.g. after a reload) so it can resume the room it lost.
        if (this.isHost || (msg.from === this.room.hostId && this.room.epoch >= 0)) {
          this.transport.send(
            { kind: 'room-state', from: this._me.id, state: this.room },
            msg.from,
          );
        }
        // Someone arriving (or coming back) mid-game needs the start payload too, or they'd sit
        // in the lobby while everyone else plays. Players resume; anyone else watches (§7).
        if (
          this.isHost &&
          this.room.phase === 'playing' &&
          this.ownStart &&
          msg.from !== this._me.id
        ) {
          this.transport.send(
            { kind: 'start', from: this._me.id, start: publicStart(this.ownStart), resumed: true },
            msg.from,
          );
        }
        break;
      case 'room-state':
        this.onRoomState(msg.from, msg.state);
        break;
      case 'ready':
        if (!this.isHost) break;
        if (!this.presence.some((p) => p.id === msg.from)) {
          this.earlyReady.set(msg.from, msg.ready); // applied when their presence arrives
          break;
        }
        this.room = { ...this.room, ready: { ...this.room.ready, [msg.from]: msg.ready } };
        this.publish();
        break;
      case 'start':
        if (msg.from !== this.room.hostId) break;
        for (const l of this.startListeners)
          l(
            msg.from === this._me.id && this.ownStart ? this.ownStart : msg.start,
            msg.resumed === true,
          );
        break;
    }
  }

  private onRoomState(from: PlayerId, state: RoomState): void {
    if (from === this._me.id || state.code !== this.room.code) return;
    if (this.room.epoch < 0 && state.hostId === this._me.id) {
      // We are the host, rejoining with no state: resume from what a peer kept.
      this.room = state;
      this.publish();
      this.watchHost();
      return;
    }
    if (from !== state.hostId) return;
    // A newer term is legitimate only if the old host is really gone (or we are that old host
    // returning) and the claimant is here. Fresh joiners accept whatever the room says.
    const claimantPresent = this.presence.some((p) => p.id === from);
    const hostPresent = this.presence.some((p) => p.id === this.room.hostId);
    // The rightful successor is the earliest-seated present player other than the current host.
    const rightfulSuccessor =
      this.orderedPresent().find((p) => p.id !== this.room.hostId)?.id === from;
    const oldHostGone = !hostPresent || (this.room.hostId === this._me.id && rightfulSuccessor);
    const newer =
      state.epoch > this.room.epoch && (this.room.epoch < 0 || (claimantPresent && oldHostGone));
    const sameTermSameHost = state.epoch === this.room.epoch && state.hostId === this.room.hostId;
    // Simultaneous claims in one term: the earlier seat wins.
    const sameTermEarlierSeat =
      state.epoch === this.room.epoch &&
      state.hostId !== this.room.hostId &&
      claimantPresent &&
      oldHostGone &&
      this.seatOf(state.hostId, state.seats) < this.seatOf(this.room.hostId, state.seats);
    if (!newer && !sameTermSameHost && !sameTermEarlierSeat) return;

    const hostChanged = state.hostId !== this.room.hostId;
    const firstState = this.room.epoch < 0;
    const gameEnded = this.room.phase === 'playing' && state.phase === 'lobby';
    this.room = state;
    this.emit();
    if (gameEnded) this.fireEnd();
    this.watchHost();
    if (hostChanged || firstState) {
      if (hostChanged && !firstState)
        for (const l of this.hostListeners) l(state.hostId, state.epoch);
      if (this.clockSamples > 0)
        void this.clock.measure(state.hostId, { count: this.clockSamples });
    }
  }

  /** Starts or cancels the migration countdown depending on whether the host is present. */
  private watchHost(): void {
    if (this.closed || this.room.epoch < 0) return;
    const hostPresent = this.presence.some((p) => p.id === this.room.hostId);
    if (hostPresent || this.isHost) {
      this.cancelMigration();
      return;
    }
    if (this.migrationTimer === null) {
      this.migrationTimer = this.scheduler.setTimeout(() => {
        this.migrationTimer = null;
        this.maybeClaimHost();
      }, HOST_MIGRATION_MS);
      this.emit();
    }
  }

  private maybeClaimHost(): void {
    if (this.closed || this.presence.some((p) => p.id === this.room.hostId)) return;
    const candidate = this.orderedPresent()[0];
    if (candidate?.id !== this._me.id) {
      this.watchHost(); // someone else should claim; keep watching in case they don't
      return;
    }
    const epoch = this.room.epoch + 1;
    this.room = {
      ...this.room,
      hostId: this._me.id,
      epoch,
      ready: Object.fromEntries(this.presence.map((p) => [p.id, this.room.ready[p.id] ?? false])),
    };
    this.publish();
    this.clock.measure(this._me.id);
    for (const l of this.hostListeners) l(this._me.id, epoch);
  }

  private cancelMigration(): void {
    if (this.migrationTimer !== null) {
      this.scheduler.clearTimeout(this.migrationTimer);
      this.migrationTimer = null;
      this.emit(); // hostAway changed
    }
  }

  private fireEnd(): void {
    for (const l of this.endListeners) l();
  }

  /** Every present player's ready flag set to `ready` (the room only tracks who is here). */
  private allReady(ready: boolean): Record<PlayerId, boolean> {
    const ids = this.presence.length
      ? this.presence.map((p) => p.id)
      : Object.keys(this.room.ready);
    return Object.fromEntries(ids.map((id) => [id, ready]));
  }

  private seatOf(id: PlayerId, seats: readonly PlayerId[]): number {
    const i = seats.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  }

  /** Present players ordered by room seat, then by transport seat for anyone not yet seated. */
  private orderedPresent(): PlayerPresence[] {
    return [...this.presence].sort(
      (a, b) =>
        this.seatOf(a.id, this.room.seats) - this.seatOf(b.id, this.room.seats) || a.seat - b.seat,
    );
  }

  /** Host: broadcast room state and update the local view. */
  private publish(): void {
    if (this.isHost)
      this.transport.send({ kind: 'room-state', from: this._me.id, state: this.room });
    this.emit();
  }

  private emit(): void {
    if (this.closed) return;
    const players = this.orderedPresent().map((p, seat) => ({
      ...p,
      name: p.id === this._me.id ? p.name : seatName(p.name, seat),
      seat,
      isHost: p.id === this.room.hostId,
      ready: this.room.ready[p.id] ?? false,
      isMe: p.id === this._me.id,
    }));
    this.view$.next({
      code: this.room.code,
      hostId: this.room.hostId,
      isHost: this.isHost,
      epoch: this.room.epoch,
      phase: this.room.phase,
      routine: this.room.routine,
      players,
      blocker: startBlocker(this.room, players),
      hostAway: this.migrationTimer !== null,
    });
  }
}

/**
 * What goes on the public channel: hidden games travel with seed 0, because the real seed would
 * let anyone replay the shuffle and read every hand (§7 privacy).
 */
function publicStart(start: GameStart): GameStart {
  return start.game.hidden ? { ...start, seed: 0 } : start;
}

export function startBlocker(room: RoomState, players: readonly LobbyPlayer[]): string | null {
  if (!room.routine) return 'Pick a routine first.';
  const { min, max } = room.routine.preview.players;
  if (players.length < min)
    return `${room.routine.preview.gameName} needs at least ${min} players.`;
  if (players.length > max)
    return `${room.routine.preview.gameName} allows at most ${max} players.`;
  const waiting = players.filter((p) => !p.ready).length;
  if (waiting) return `Waiting for ${waiting} ${waiting === 1 ? 'player' : 'players'} to be ready.`;
  return null;
}
