import { EngineEventSchema } from '../../domain/engine/events';
import type { Task } from '../../domain/engine/state';
import type { Exercise, Measure, Session, Suit } from '../../domain/models/schemas';

export interface ExerciseTotal {
  key: string;
  name: string;
  measure: Measure;
  amount: number;
  sessions: number;
}

export interface GroupTotal {
  /** Suit label as it was in the deck played, e.g. "Legs". Same label across decks merges. */
  label: string;
  suit: Suit;
  reps: number;
  seconds: number;
}

export interface SessionRow {
  session: Session;
  reps: number;
  seconds: number;
  tasks: number;
  minutes: number | null;
  inProgress: boolean;
}

export interface HistoryStats {
  sessions: SessionRow[];
  workouts: number;
  reps: number;
  seconds: number;
  minutes: number;
  byExercise: ExerciseTotal[];
  byGroup: GroupTotal[];
}

/**
 * Aggregates saved sessions for the history screen (the device's own player).
 * Per exercise: Session.totals. Per suit group: completed work attributed through the
 * log (TaskAssigned → first card's suit → that deck's label). Rest never counts.
 */
export function historyStats(sessions: readonly Session[], exercisesById: ReadonlyMap<string, Pick<Exercise, 'name' | 'measure'>>): HistoryStats {
  const byExercise = new Map<string, ExerciseTotal>();
  const byGroup = new Map<string, GroupTotal>();
  const rows: SessionRow[] = [];

  for (const session of [...sessions].sort((a, b) => b.startedAt - a.startedAt)) {
    const me = session.playerId ?? session.players[0]?.id;
    if (!me) continue;
    const suitOf = new Map(session.deck.cards.map((c) => [c.id, c.suit]));
    const labelOf = new Map(session.deck.suits.map((s) => [s.suit, s.label]));
    const tasks = new Map<string, Task>();
    let reps = 0;
    let seconds = 0;
    let done = 0;

    for (const raw of session.log) {
      const parsed = EngineEventSchema.safeParse(raw); // stored log is loose; skip anything unrecognized
      if (!parsed.success) continue;
      const event = parsed.data;
      if (event.type === 'TaskAssigned' && event.task.playerId === me) tasks.set(event.task.id, event.task);
      if (event.type !== 'TaskCompleted') continue;
      const { taskId, amount, playerId } = event;
      const task = tasks.get(taskId);
      if (!task || playerId !== me) continue;
      done++;
      if (task.kind === 'rest') continue;
      if (task.measure === 'seconds') seconds += amount;
      else reps += amount;

      const suit = suitOf.get(task.cardIds[0]) ?? 'joker';
      const label = labelOf.get(suit) ?? suit;
      const g = byGroup.get(label) ?? { label, suit, reps: 0, seconds: 0 };
      if (task.measure === 'seconds') g.seconds += amount;
      else g.reps += amount;
      byGroup.set(label, g);
    }

    for (const [key, amount] of Object.entries(session.totals[me] ?? {})) {
      const ex = exercisesById.get(key);
      const measure: Measure = ex?.measure ?? (key === 'bonus-cardio' ? 'seconds' : 'reps');
      const name = ex?.name ?? (key === 'wild' ? 'Wild card' : key === 'bonus-cardio' ? 'Bonus cardio' : 'Removed exercise');
      const t = byExercise.get(key) ?? { key, name, measure, amount: 0, sessions: 0 };
      t.amount += amount;
      t.sessions++;
      byExercise.set(key, t);
    }

    rows.push({
      session,
      reps,
      seconds,
      tasks: done,
      minutes: session.endedAt ? Math.max(1, Math.round((session.endedAt - session.startedAt) / 60000)) : null,
      inProgress: !session.endedAt,
    });
  }

  return {
    sessions: rows,
    workouts: rows.length,
    reps: rows.reduce((n, r) => n + r.reps, 0),
    seconds: rows.reduce((n, r) => n + r.seconds, 0),
    minutes: rows.reduce((n, r) => n + (r.minutes ?? 0), 0),
    byExercise: [...byExercise.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name)),
    byGroup: [...byGroup.values()].sort((a, b) => b.reps + b.seconds / 5 - (a.reps + a.seconds / 5) || a.label.localeCompare(b.label)),
  };
}
