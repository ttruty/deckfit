import { dayKey } from '../../domain/challenges/progress';
import type { SessionRow } from './history-stats';

export interface ActivityDay {
  /** Local calendar day, `YYYY-MM-DD` — the key everything else is grouped by. */
  date: string;
  /** Local midnight, for date formatting in the UI. */
  at: number;
  workouts: number;
  /** Work done that day on the card-value scale: 1 per rep, 1 per 5 seconds (§6.1). */
  points: number;
  /** Shading step, 0 (nothing) to 4 (your busiest day in view). */
  level: 0 | 1 | 2 | 3 | 4;
  /** Days in the last column that haven't happened yet. */
  future: boolean;
}

export interface ActivityGrid {
  /** Columns of seven days, Monday at the top, oldest column first. */
  weeks: ActivityDay[][];
  /** Month label for each column, only where the month changes. */
  months: (string | null)[];
  activeDays: number;
  /** Days in a row up to today. Today not being done yet doesn't break it. */
  currentStreak: number;
  /** Longest run of days ever, not just the ones in view. */
  bestStreak: number;
  /** Points in the window. */
  points: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export { dayKey };

/** Local midnight of the day `at` falls in. */
function startOfDay(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Monday of the week `at` falls in (weeks read Monday → Sunday). */
function startOfWeek(at: number): number {
  const d = new Date(startOfDay(at));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** Work a session is worth on the card-value scale; rest never counts (it isn't in the row). */
function pointsOf(row: SessionRow): number {
  return row.reps + row.seconds / 5;
}

/**
 * The activity grid (§9e): one square per day for the last `weeks` weeks, shaded by how much
 * work that day held, plus the streaks. Pure — the caller passes `today` so tests (and a device
 * that crosses midnight mid-session) are deterministic.
 */
export function activityGrid(rows: readonly SessionRow[], today: number, weeks = 26): ActivityGrid {
  const byDay = new Map<string, { workouts: number; points: number }>();
  for (const row of rows) {
    const key = dayKey(row.session.startedAt);
    const day = byDay.get(key) ?? { workouts: 0, points: 0 };
    day.workouts++;
    day.points += pointsOf(row);
    byDay.set(key, day);
  }

  const todayKey = dayKey(today);
  // Stepped with setDate, never raw milliseconds: a DST change would shift the whole grid by a day.
  const first = new Date(startOfWeek(today));
  first.setDate(first.getDate() - (weeks - 1) * 7);
  const firstDay = first.getTime();
  const columns: ActivityDay[][] = [];
  let points = 0;
  let activeDays = 0;
  let max = 0;

  for (let w = 0; w < weeks; w++) {
    const column: ActivityDay[] = [];
    for (let d = 0; d < 7; d++) {
      // Built from a Date, not a fixed 86.4M ms step, so a DST change doesn't shift the grid.
      const date = new Date(firstDay);
      date.setDate(date.getDate() + w * 7 + d);
      const at = date.getTime();
      const key = dayKey(at);
      const found = byDay.get(key);
      max = Math.max(max, found?.points ?? 0);
      if (found) {
        points += found.points;
        activeDays++;
      }
      column.push({
        date: key,
        at,
        workouts: found?.workouts ?? 0,
        points: Math.round(found?.points ?? 0),
        level: 0,
        future: at > startOfDay(today),
      });
    }
    columns.push(column);
  }

  const months = monthLabels(columns);

  // Shading is relative to the busiest day in view, so a light week still reads as something.
  for (const column of columns) {
    for (const day of column) {
      day.level = day.points > 0 ? (Math.min(4, Math.ceil((day.points / Math.max(max, 1)) * 4)) as 1 | 2 | 3 | 4) : 0;
    }
  }

  return {
    weeks: columns,
    months,
    activeDays,
    points: Math.round(points),
    currentStreak: streakTo(byDay, todayKey, today),
    bestStreak: bestStreak(byDay),
  };
}

/**
 * A label on the column where each month starts. The first column is usually a stub of the month
 * before, so it is labelled only when that month carries on; and two labels never land within a
 * column of each other, where they would overlap.
 */
function monthLabels(columns: readonly ActivityDay[][]): (string | null)[] {
  const monthOf = columns.map((c) => new Date(c[0].at).getMonth());
  const labels = monthOf.map((month, i) =>
    (i === 0 ? monthOf[1] === month : month !== monthOf[i - 1]) ? MONTHS[month] : null,
  );
  let last = -2;
  return labels.map((label, i) => {
    if (!label || i - last < 2) return null;
    last = i;
    return label;
  });
}

/**
 * Days in a row ending today. A day with no workout yet doesn't break the streak — it only
 * breaks once that day is over — so today counts as "still open" and we start from yesterday.
 */
function streakTo(byDay: ReadonlyMap<string, unknown>, todayKey: string, today: number): number {
  let streak = byDay.has(todayKey) ? 1 : 0;
  const cursor = new Date(startOfDay(today));
  cursor.setDate(cursor.getDate() - 1); // either way, counting continues from yesterday
  while (byDay.has(dayKey(cursor.getTime()))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function bestStreak(byDay: ReadonlyMap<string, unknown>): number {
  const days = [...byDay.keys()].sort();
  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const key of days) {
    const date = new Date(`${key}T00:00:00`);
    date.setDate(date.getDate() - 1);
    run = previous === dayKey(date.getTime()) ? run + 1 : 1;
    previous = key;
    best = Math.max(best, run);
  }
  return best;
}
