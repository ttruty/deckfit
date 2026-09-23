import { dayKey } from '../../domain/challenges/progress';
import type { Exercise, Measure } from '../../domain/models/schemas';
import type { SessionRow } from './history-stats';

export interface DayWorkout {
  id: string;
  at: number;
  game: string;
  deck: string;
  reps: number;
  seconds: number;
  tasks: number;
  minutes: number | null;
  inProgress: boolean;
  /** Multiplayer: who else was in it. */
  others: number;
}

export interface DayExercise {
  key: string;
  name: string;
  measure: Measure;
  amount: number;
}

export interface DayDetail {
  day: string;
  /** Local midnight, for formatting the date. */
  at: number;
  workouts: DayWorkout[];
  reps: number;
  seconds: number;
  /** Card-value scale, the same number the grid shades by (§9e). */
  points: number;
  /** What was worked that day, biggest first. */
  exercises: DayExercise[];
}

/**
 * One day of history, opened from the activity grid (§9e): the workouts in it, and what they
 * added up to. Pure, so the whole thing is a function of the rows History already loaded.
 */
export function dayDetail(
  rows: readonly SessionRow[],
  exercisesById: ReadonlyMap<string, Pick<Exercise, 'name' | 'measure'>>,
  day: string,
): DayDetail {
  const mine = rows.filter((row) => dayKey(row.session.startedAt) === day).sort((a, b) => a.session.startedAt - b.session.startedAt);
  const totals = new Map<string, DayExercise>();

  for (const row of mine) {
    const me = row.session.playerId ?? row.session.players[0]?.id;
    for (const [key, amount] of Object.entries(me ? (row.session.totals[me] ?? {}) : {})) {
      const found = exercisesById.get(key);
      const measure: Measure = found?.measure ?? (key === 'bonus-cardio' ? 'seconds' : 'reps');
      const name = found?.name ?? (key === 'wild' ? 'Wild card' : key === 'bonus-cardio' ? 'Bonus cardio' : 'Removed exercise');
      const total = totals.get(key) ?? { key, name, measure, amount: 0 };
      total.amount += amount;
      totals.set(key, total);
    }
  }

  const reps = mine.reduce((n, row) => n + row.reps, 0);
  const seconds = mine.reduce((n, row) => n + row.seconds, 0);
  return {
    day,
    at: mine[0]?.session.startedAt ?? new Date(`${day}T12:00:00`).getTime(),
    workouts: mine.map((row) => ({
      id: row.session.id,
      at: row.session.startedAt,
      game: row.session.game.name,
      deck: row.session.deck.name,
      reps: row.reps,
      seconds: row.seconds,
      tasks: row.tasks,
      minutes: row.minutes,
      inProgress: row.inProgress,
      others: Math.max(0, row.session.players.length - 1),
    })),
    reps,
    seconds,
    points: Math.round(reps + seconds / 5),
    exercises: [...totals.values()].sort(
      (a, b) => b.amount / (b.measure === 'seconds' ? 5 : 1) - a.amount / (a.measure === 'seconds' ? 5 : 1) || a.name.localeCompare(b.name),
    ),
  };
}
