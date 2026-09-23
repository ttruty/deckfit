import { EngineEventSchema } from '../engine/events';
import type { Challenge, ChallengeDay } from '../models/challenge.schema';
import type { Measure, Session } from '../models/schemas';

/** A finished (or in-progress) workout, reduced to what a challenge cares about. */
export interface WorkSession {
  startedAt: number;
  reps: number;
  seconds: number;
}

export interface WorkDay {
  points: number;
  workouts: number;
}

/**
 * `YYYY-MM-DD` in the device's own timezone. Challenges are counted in the player's local days:
 * an 11pm workout belongs to that day, wherever the server thinks it is.
 */
export function dayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Work per local day, on the card-value scale: 1 per rep, 1 per 5 seconds held (§6.1). */
export function dailyWork(sessions: readonly WorkSession[]): Map<string, WorkDay> {
  const byDay = new Map<string, WorkDay>();
  for (const session of sessions) {
    const key = dayKey(session.startedAt);
    const day = byDay.get(key) ?? { points: 0, workouts: 0 };
    day.points += session.reps + session.seconds / 5;
    day.workouts++;
    byDay.set(key, day);
  }
  for (const day of byDay.values()) day.points = Math.round(day.points);
  return byDay;
}

/**
 * The rows this device should send for one challenge: its own days inside the challenge window
 * whose numbers have changed. Nothing else is ever written, and a day is only reported once it
 * has work in it — so a quiet day costs a write only when it stops being quiet.
 */
export function daysToUpload(
  challenge: Pick<Challenge, 'startsOn' | 'endsOn'>,
  playerId: string,
  work: ReadonlyMap<string, WorkDay>,
  known: readonly ChallengeDay[],
): ChallengeDay[] {
  const stored = new Map(known.filter((d) => d.playerId === playerId).map((d) => [d.day, d]));
  const out: ChallengeDay[] = [];
  for (const [day, { points, workouts }] of work) {
    if (day < challenge.startsOn || day > challenge.endsOn) continue;
    const row = stored.get(day);
    if (row && row.points === points && row.workouts === workouts) continue;
    out.push({ playerId, day, points, workouts });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * What's left of a debt (§7b): the pot lands as reps you owe, and any work you do after the
 * challenge ends pays it down — on the same scale as everything else.
 */
export function debtRemaining(owed: number, endsOn: string, work: ReadonlyMap<string, WorkDay>): number {
  let paid = 0;
  for (const [day, { points }] of work) if (day > endsOn) paid += points;
  return Math.max(0, owed - paid);
}

/**
 * What one saved workout is worth, from this device's own player: completed tasks only, rest
 * never counts. (History's `historyStats` walks the same events for its richer per-suit totals;
 * this is the small version domain code can use without reaching into a feature.)
 */
export function sessionWork(session: Session): WorkSession {
  const me = session.playerId ?? session.players[0]?.id;
  const tasks = new Map<string, { measure: Measure; kind: string }>();
  let reps = 0;
  let seconds = 0;
  for (const raw of session.log) {
    const parsed = EngineEventSchema.safeParse(raw); // a stored log is loose: skip what we can't read
    if (!parsed.success) continue;
    const event = parsed.data;
    if (event.type === 'TaskAssigned' && event.task.playerId === me) {
      tasks.set(event.task.id, { measure: event.task.measure, kind: event.task.kind });
    }
    if (event.type !== 'TaskCompleted' || event.playerId !== me) continue;
    const task = tasks.get(event.taskId);
    if (!task || task.kind === 'rest') continue;
    if (task.measure === 'seconds') seconds += event.amount;
    else reps += event.amount;
  }
  return { startedAt: session.startedAt, reps, seconds };
}
