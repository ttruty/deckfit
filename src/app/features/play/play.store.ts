import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import type { Subscription } from 'rxjs';
import { AudioCueService } from '../../core/audio/audio-cue.service';
import { ExerciseRepository, GameRepository, SessionRepository } from '../../core/db/repositories';
import { GameHost, replay } from '../../core/sync/game-host';
import { LoopbackTransport } from '../../core/sync/loopback-transport';
import { Clock } from '../../core/time/clock.service';
import { WakeLockService } from '../../core/wake-lock/wake-lock.service';
import { cardAmount, scaleAmount } from '../../domain/engine/amounts';
import { createDslRules } from '../../domain/engine/dsl/interpreter';
import type { EngineEvent } from '../../domain/engine/events';
import type { Intent, IntentInput } from '../../domain/engine/intents';
import { createContext, createInitialState, type EngineContext } from '../../domain/engine/reducer';
import type { GameState, Task, Timer } from '../../domain/engine/state';
import type { Card, Exercise, Session } from '../../domain/models/schemas';
import { SUIT_NAME } from '../../shared/labels';
import type { CardFaceModel } from '../../shared/ui/card-face/card-face.component';
import { toCardFaceModel } from '../../shared/ui/card-face/card-face-model';


const JOKER_TASK_NAME: Record<Exclude<Task['kind'], 'exercise'>, string> = {
  rest: 'Rest',
  wild: 'Wild card — any exercise',
  'bonus-cardio': 'Bonus cardio',
};

const TICK_MS = 250;

export interface WorkoutSummary {
  rows: { key: string; name: string; amount: number; unit: string }[];
  outcome: 'finished' | 'abandoned';
  minutes: number;
  reps: number;
  seconds: number;
  tasks: number;
  skipped: number;
}

/**
 * Runs one play session on this device (§9): engine behind a GameHost on a
 * LoopbackTransport, persistence after every step (so a reload resumes), timers,
 * wake lock, and audio cues. Components only read signals and call intents.
 */
@Injectable()
export class PlayStore implements OnDestroy {
  private readonly sessions = inject(SessionRepository);
  private readonly games = inject(GameRepository);
  private readonly exerciseRepo = inject(ExerciseRepository);
  private readonly clock = inject(Clock);
  private readonly audio = inject(AudioCueService);
  private readonly wakeLock = inject(WakeLockService);

  readonly status = signal<'loading' | 'ready' | 'error'>('loading');
  readonly error = signal<string | null>(null);
  readonly session = signal<Session | null>(null);
  readonly state = signal<GameState | null>(null);
  readonly exercisesById = signal<ReadonlyMap<string, Exercise>>(new Map());
  /** Screen-reader announcement (aria-live). */
  readonly announcement = signal('');
  readonly rejection = signal<string | null>(null);
  /** Monotonic time, ticking while anything is timed. */
  readonly now = signal(0);

  /** Countdown for the current timed task, started by the player. */
  readonly taskTimer = signal<{ taskId: string; startedAt: number; durationMs: number } | null>(null);
  /** Engine timers (e.g. time cap): start times observed on this device. */
  private readonly timerStarts = signal<ReadonlyMap<string, number>>(new Map());

  private ctx: EngineContext | null = null;
  private host: GameHost | null = null;
  private transport: LoopbackTransport | null = null;
  private sub: Subscription | null = null;
  private stopTicking: (() => void) | null = null;
  private intents: Intent[] = [];
  private log: EngineEvent[] = [];
  private writeChain: Promise<unknown> = Promise.resolve();
  private lastBeepSecond: number | null = null;

  readonly me = computed(() => this.session()?.players[0]?.id ?? '');
  readonly phase = computed(() => this.state()?.phase ?? 'setup');
  readonly finished = computed(() => this.phase() === 'finished' || !!this.session()?.endedAt);

  readonly tableCards = computed(() => {
    const state = this.state();
    const session = this.session();
    if (!state || !session || !this.ctx) return [];
    const byId = this.exercisesById();
    return state.zones.table.map((id) => {
      const card = this.ctx!.cardsById.get(id)!;
      return { id, card, faceUp: state.faceUp.includes(id), face: this.cardFace(card, byId, session) };
    });
  });

  readonly currentTask = computed(() => {
    const state = this.state();
    const task = state?.tasks.find((t) => t.status === 'pending' && t.playerId === this.me());
    if (!task) return null;
    const chosenId = task.kind === 'wild' ? this.wildChoice() : null;
    const ex = task.exerciseId ? this.exercisesById().get(task.exerciseId) : (chosenId ? this.exercisesById().get(chosenId) : undefined);
    return {
      task,
      wild: task.kind === 'wild',
      name: ex?.name ?? JOKER_TASK_NAME[task.kind as Exclude<Task['kind'], 'exercise'>] ?? 'Exercise',
      figure: ex?.figure ?? null,
      cues: ex?.cues ?? [],
      unit: task.measure === 'seconds' ? 'sec' : 'reps',
    };
  });

  readonly canFlip = computed(() => this.phase() === 'playing' && !this.finished() && !this.state()?.tasks.some((t) => t.status === 'pending'));
  readonly drawCount = computed(() => this.state()?.zones.draw.length ?? 0);
  readonly cardsTotal = computed(() => this.session()?.deck.cards.length ?? 0);
  readonly doneCount = computed(() => this.state()?.tasks.filter((t) => t.status === 'done').length ?? 0);

  readonly taskTimerView = computed(() => {
    const t = this.taskTimer();
    if (!t) return null;
    const elapsed = Math.max(0, this.now() - t.startedAt);
    const remainingMs = Math.max(0, t.durationMs - elapsed);
    return { remaining: Math.ceil(remainingMs / 1000), progress: Math.min(1, elapsed / t.durationMs), elapsedSec: Math.floor(elapsed / 1000) };
  });

  readonly engineTimers = computed(() => {
    const starts = this.timerStarts();
    return (this.state()?.timers ?? []).map((timer: Timer) => {
      const startedAt = starts.get(timer.id) ?? this.now();
      const elapsed = Math.max(0, this.now() - startedAt);
      const remainingMs = Math.max(0, timer.durationSec * 1000 - elapsed);
      return { timer, remaining: Math.ceil(remainingMs / 1000) };
    });
  });

  readonly summary = computed((): WorkoutSummary | null => {
    const session = this.session();
    const state = this.state();
    if (!session || !this.finished()) return null;
    const totals = state?.totals[this.me()] ?? session.totals[this.me()] ?? {};
    const byId = this.exercisesById();
    const rows = Object.entries(totals).map(([key, amount]) => {
      const ex = byId.get(key);
      const seconds = ex ? ex.measure === 'seconds' : key === 'bonus-cardio';
      return { key, name: ex?.name ?? (key === 'wild' ? 'Wild card' : key === 'bonus-cardio' ? 'Bonus cardio' : key), amount, unit: seconds ? 'sec' : 'reps' };
    }).sort((a, b) => b.amount - a.amount);
    const endedAt = session.endedAt ?? this.clock.epoch();
    return {
      rows,
      outcome: session.outcome ?? 'finished',
      minutes: Math.max(1, Math.round((endedAt - session.startedAt) / 60000)),
      reps: rows.filter((r) => r.unit === 'reps').reduce((n, r) => n + r.amount, 0),
      seconds: rows.filter((r) => r.unit === 'sec').reduce((n, r) => n + r.amount, 0),
      tasks: state?.tasks.filter((t) => t.status === 'done').length ?? 0,
      skipped: state?.tasks.filter((t) => t.status === 'skipped').length ?? 0,
    };
  });

  async load(sessionId: string): Promise<void> {
    this.status.set('loading');
    const session = await this.sessions.get(sessionId);
    if (!session) return this.fail('That workout was not found.');
    const [def, exercises] = await Promise.all([this.games.get(session.game.id), this.exerciseRepo.list()]);
    if (!def) return this.fail(`The game “${session.game.name}” is no longer installed.`);

    this.exercisesById.set(new Map(exercises.map((e) => [e.id, e])));
    this.ctx = createContext(session.deck, exercises, session.settings, createDslRules(def));
    const initial = createInitialState({ players: session.players.map((p) => p.id), seed: session.seed, deck: session.deck });

    // Resume: replay stored intents and check they reproduce the stored log exactly.
    let state = initial;
    this.intents = (session.intents ?? []) as Intent[];
    this.log = session.log as EngineEvent[];
    if (this.intents.length) {
      const replayed = replay(initial, this.intents, this.ctx);
      if (JSON.stringify(replayed.events) === JSON.stringify(this.log)) {
        state = replayed.state;
      } else {
        console.warn('Saved progress does not replay identically (content changed?); restarting this workout.');
        this.intents = [];
        this.log = [];
      }
    }

    this.session.set(session);
    this.state.set(state);
    this.transport = new LoopbackTransport();
    await this.transport.createRoom(session.players[0]);
    this.host = new GameHost(this.transport, this.ctx, state, { seq: this.intents.length, log: this.log });
    this.host.onStep((step) => {
      this.intents.push(step.intent);
      this.log.push(...step.events);
      this.persist();
    });
    this.host.start();
    this.sub = this.transport.messages$.subscribe((msg) => {
      if (msg.kind !== 'events' || !this.host) return;
      this.state.set(this.host.state);
      this.onEvents(msg.events);
    });

    this.now.set(this.clock.now());
    this.status.set('ready');
    if (session.endedAt) return;
    for (const t of state.timers) this.markTimerStarted(t.id);
    this.startTicking();
    void this.wakeLock.request();
    if (state.phase === 'setup') this.dispatch({ type: 'deal' });
  }

  // ── Player actions ────────────────────────────────────────────────────────

  flip(): void {
    this.audio.unlock();
    this.dispatch({ type: 'flip' });
  }

  /** Completes the current task. Timed tasks log elapsed seconds if the countdown is running. */
  /** Wild jokers: the exercise the player picked for the current task (logged under it). */
  readonly wildChoice = signal<string | null>(null);

  /** Exercises available for a wild joker: the ones in this session's deck. */
  readonly wildOptions = computed(() => {
    const deck = this.session()?.deck;
    const byId = this.exercisesById();
    if (!deck) return [];
    const ids = [...new Set(deck.cards.flatMap((c) => (c.exerciseId ? [c.exerciseId] : [])))];
    return ids.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : [])).sort((a, b) => a.name.localeCompare(b.name));
  });

  complete(amount?: number): void {
    const current = this.currentTask();
    if (!current) return;
    this.audio.unlock();
    const timer = this.taskTimerView();
    const running = this.taskTimer()?.taskId === current.task.id && timer && timer.remaining > 0;
    const logged = running ? Math.min(timer.elapsedSec, current.task.amount) : amount;
    this.taskTimer.set(null);
    const chosen = current.task.kind === 'wild' ? this.wildChoice() : null;
    this.wildChoice.set(null);
    this.dispatch({
      type: 'completeTask', taskId: current.task.id,
      ...(logged === undefined ? {} : { amount: logged }),
      ...(chosen ? { exerciseId: chosen } : {}),
    });
  }

  skip(): void {
    const current = this.currentTask();
    if (!current) return;
    this.taskTimer.set(null);
    this.wildChoice.set(null);
    this.dispatch({ type: 'skipTask', taskId: current.task.id });
  }

  startTaskTimer(): void {
    const current = this.currentTask();
    if (!current || current.task.measure !== 'seconds') return;
    this.audio.unlock();
    this.audio.play('go');
    this.lastBeepSecond = null;
    this.taskTimer.set({ taskId: current.task.id, startedAt: this.clock.now(), durationMs: current.task.amount * 1000 });
    this.now.set(this.clock.now());
  }

  /** Ends early: saves what was done as an abandoned session. */
  async abandon(): Promise<void> {
    if (this.finished()) return;
    await this.finalize('abandoned');
  }

  ngOnDestroy(): void {
    this.stopTicking?.();
    this.sub?.unsubscribe();
    this.host?.stop();
    void this.transport?.leave();
    void this.wakeLock.release();
  }

  /** Resolves when pending writes are flushed (tests, navigation). */
  flushed(): Promise<unknown> {
    return this.writeChain;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private dispatch(intent: IntentInput): void {
    if (!this.transport || this.finished()) return;
    this.rejection.set(null);
    this.transport.send({ kind: 'intent', from: this.me(), intent: { ...intent, playerId: this.me() } as Intent });
  }

  private onEvents(events: readonly EngineEvent[]): void {
    const byId = this.exercisesById();
    for (const e of events) {
      switch (e.type) {
        case 'CardFlipped':
        case 'CardsDealt': {
          const ids = e.type === 'CardFlipped' ? [e.cardId] : e.cardIds;
          this.audio.play('flip');
          this.announcement.set(`Dealt ${ids.map((id) => this.describeCard(id)).join(', ')}`);
          break;
        }
        case 'TaskAssigned': {
          const t = e.task;
          if (t.playerId !== this.me()) break;
          const name = t.exerciseId ? (byId.get(t.exerciseId)?.name ?? 'exercise') : JOKER_TASK_NAME[t.kind as Exclude<Task['kind'], 'exercise'>];
          const phrase = t.measure === 'seconds' ? `${t.amount} seconds ${name}` : `${t.amount} ${name}`;
          this.announcement.set(`Your task: ${phrase}`);
          this.audio.say(phrase);
          break;
        }
        case 'TaskCompleted':
          this.audio.play('done');
          break;
        case 'TimerStarted':
          this.markTimerStarted(e.timer.id);
          break;
        case 'IntentRejected':
          this.rejection.set(REJECTION_TEXT[e.reason] ?? `Not allowed right now (${e.reason}).`);
          break;
        case 'GameOver':
          this.announcement.set('Workout complete');
          this.audio.say('Workout complete');
          void this.finalize('finished');
          break;
      }
    }
  }

  private onTick(): void {
    const now = this.clock.now();
    this.now.set(now);

    const task = this.taskTimerView();
    const timer = this.taskTimer();
    if (timer && task) {
      if (task.remaining <= 3 && task.remaining > 0 && this.lastBeepSecond !== task.remaining) {
        this.lastBeepSecond = task.remaining;
        this.audio.play('tick');
      }
      if (task.remaining === 0 && this.currentTask()?.task.id === timer.taskId) {
        this.taskTimer.set(null);
        this.dispatch({ type: 'completeTask', taskId: timer.taskId });
      }
    }

    for (const { timer: t, remaining } of this.engineTimers()) {
      if (remaining === 0 && this.timerStarts().has(t.id)) {
        const starts = new Map(this.timerStarts());
        starts.delete(t.id);
        this.timerStarts.set(starts);
        this.dispatch({ type: 'timerElapsed', timerId: t.id });
      }
    }
  }

  private startTicking(): void {
    this.stopTicking ??= this.clock.every(TICK_MS, () => this.onTick());
  }

  private markTimerStarted(id: string): void {
    const now = this.clock.now();
    this.now.set(now);
    this.timerStarts.set(new Map(this.timerStarts()).set(id, now));
  }

  private persist(extra: Partial<Session> = {}): Promise<unknown> {
    const session = this.session();
    const state = this.host?.state;
    if (!session || !state) return this.writeChain;
    const next: Session = {
      ...session,
      ...extra,
      log: [...this.log],
      intents: [...this.intents],
      totals: state.totals,
    };
    this.session.set(next);
    this.writeChain = this.writeChain.then(() => this.sessions.save(next)).catch((err: unknown) => console.error('Saving session failed', err));
    return this.writeChain;
  }

  private async finalize(outcome: 'finished' | 'abandoned'): Promise<void> {
    if (this.session()?.endedAt) return;
    this.stopTicking?.();
    this.stopTicking = null;
    this.taskTimer.set(null);
    void this.wakeLock.release();
    await this.persist({ endedAt: this.clock.epoch(), outcome });
  }

  private cardFace(card: Card, byId: ReadonlyMap<string, Exercise>, session: Session): CardFaceModel {
    const ex = card.exerciseId ? byId.get(card.exerciseId) : undefined;
    const amount = ex ? scaleAmount(cardAmount(card, ex.measure, session.settings), ex.measure, session.settings) : 0;
    return toCardFaceModel(card, session.deck, byId, amount);
  }

  private describeCard(id: string): string {
    const card = this.ctx?.cardsById.get(id);
    if (!card) return 'a card';
    if (card.suit === 'joker') return 'a joker';
    const ex = card.exerciseId ? this.exercisesById().get(card.exerciseId) : undefined;
    return `${card.rank} of ${SUIT_NAME[card.suit]}${ex ? `, ${ex.name}` : ''}`;
  }

  private fail(message: string): void {
    this.error.set(message);
    this.status.set('error');
  }
}

const REJECTION_TEXT: Record<string, string> = {
  'tasks-pending': 'Finish or skip the current task first.',
  'not-your-turn': "It isn't your turn.",
  'game-over': 'This workout is over.',
};
