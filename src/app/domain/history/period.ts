import { dayKey } from '../challenges/progress';
import type { Measure, Suit } from '../models/schemas';
import type { SessionRow } from './history-stats';

/** The windows the Totals section offers. */
export type Period = 'week' | 'month' | '26w';

export const PERIODS: { id: Period; label: string; days: number }[] = [
  { id: 'week', label: 'Week', days: 7 },
  { id: 'month', label: 'Month', days: 30 },
  { id: '26w', label: '26 weeks', days: 182 },
];

/** The four suits in the order the bars read, and the labels a deck gives them by default. */
export const GROUP_SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
const DEFAULT_LABELS: Record<string, string> = {
  hearts: 'Legs',
  diamonds: 'Push',
  clubs: 'Pull',
  spades: 'Core',
};

export interface GroupBar {
  suit: Suit;
  label: string;
  reps: number;
  seconds: number;
}

export interface PeriodExercise {
  key: string;
  name: string;
  measure: Measure;
  suit: Suit;
  amount: number;
  /** How many workouts in the window included it. */
  sessions: number;
}

export interface PeriodTotals {
  period: Period;
  /** First day counted, `YYYY-MM-DD`. */
  from: string;
  workouts: number;
  reps: number;
  seconds: number;
  /** Time spent working out, in minutes (a session still running counts nothing). */
  minutes: number;
  /** Always all four suits, so a group you haven't been dealt still reads as zero. */
  groups: GroupBar[];
  /** Biggest first, on a common scale (5 seconds = 1 rep). */
  exercises: PeriodExercise[];
}

/**
 * What one suit is called for this player: decks disagree (Legs/Push/Pull/Core, but yoga calls
 * ♣ Spine), so take the label they've been dealt most often, and fall back to the strength names.
 */
export function suitLabels(rows: readonly SessionRow[]): Record<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const row of rows) {
    for (const group of row.groups) {
      const perSuit = counts.get(group.suit) ?? new Map<string, number>();
      perSuit.set(group.label, (perSuit.get(group.label) ?? 0) + 1);
      counts.set(group.suit, perSuit);
    }
  }
  const labels: Record<string, string> = { ...DEFAULT_LABELS };
  for (const [suit, perSuit] of counts) {
    const best = [...perSuit.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (best) labels[suit] = best[0];
  }
  return labels;
}

/** Work on the card-value scale (§6.1), for ranking reps and holds against each other. */
function points(amount: number, measure: Measure): number {
  return measure === 'seconds' ? amount / 5 : amount;
}

/**
 * Everything the Totals section shows, for one window ending today. Pure: History hands it the
 * rows it already loaded, so switching period costs nothing.
 */
export function periodTotals(rows: readonly SessionRow[], today: number, period: Period): PeriodTotals {
  const days = PERIODS.find((p) => p.id === period)?.days ?? 182;
  const first = new Date(today);
  first.setHours(0, 0, 0, 0);
  first.setDate(first.getDate() - (days - 1));
  const from = dayKey(first.getTime());
  const inWindow = rows.filter((row) => dayKey(row.session.startedAt) >= from);
  const labels = suitLabels(rows);

  const groups = new Map<Suit, GroupBar>(
    GROUP_SUITS.map((suit) => [suit, { suit, label: labels[suit] ?? suit, reps: 0, seconds: 0 }]),
  );
  const exercises = new Map<string, PeriodExercise>();

  for (const row of inWindow) {
    for (const group of row.groups) {
      const bar = groups.get(group.suit);
      if (!bar) continue; // jokers have no group of their own
      bar.reps += group.reps;
      bar.seconds += group.seconds;
    }
    for (const exercise of row.exercises) {
      const found = exercises.get(exercise.key) ?? { ...exercise, amount: 0, sessions: 0 };
      found.amount += exercise.amount;
      found.sessions++;
      // A key can show up with no suit (an old log); keep the first real one we see.
      if (found.suit === 'joker' && exercise.suit !== 'joker') found.suit = exercise.suit;
      exercises.set(exercise.key, found);
    }
  }

  return {
    period,
    from,
    workouts: inWindow.length,
    reps: inWindow.reduce((n, row) => n + row.reps, 0),
    seconds: inWindow.reduce((n, row) => n + row.seconds, 0),
    minutes: inWindow.reduce((n, row) => n + (row.minutes ?? 0), 0),
    groups: GROUP_SUITS.map((suit) => groups.get(suit)!),
    exercises: [...exercises.values()].sort(
      (a, b) => points(b.amount, b.measure) - points(a.amount, a.measure) || a.name.localeCompare(b.name),
    ),
  };
}
