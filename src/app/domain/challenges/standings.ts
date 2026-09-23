import type { Challenge, ChallengeDay, ChallengeGoal, ChallengeState } from '../models/challenge.schema';
import type { WorkDay } from './progress';

export interface PlayerStanding {
  playerId: string;
  name: string;
  /** Days of the challenge, up to and including today, that this player made. */
  made: number;
  /** Days already gone that they missed — each one dropped their ante into the pot. */
  missed: number;
  /** Work logged across the challenge so far, on the card-value scale. */
  points: number;
  /** Reps they put into the pot by missing. */
  staked: number;
  /** Their share of the pot once it's over (0 while it runs, or if they never missed). */
  owed: number;
  /** True while they can still finish clean. */
  clean: boolean;
  /** Today, for a goal counted per day: done, or still open. */
  todayDone: boolean;
}

export interface ChallengeStandings {
  days: string[];
  /** Days that have finished (today only counts once it's over). */
  daysGone: number;
  /** Everything missed so far, in reps. */
  pot: number;
  /** True once the last day is behind us. */
  over: boolean;
  players: PlayerStanding[];
  /** Per player, per day: made / missed / still open — the row of squares in the UI. */
  grid: Record<string, ('made' | 'missed' | 'open')[]>;
}

/** Every day of the challenge, `YYYY-MM-DD`, inclusive. */
export function challengeDays(challenge: Pick<Challenge, 'startsOn' | 'endsOn'>): string[] {
  const days: string[] = [];
  const cursor = new Date(`${challenge.startsOn}T00:00:00`);
  const last = new Date(`${challenge.endsOn}T00:00:00`);
  while (cursor.getTime() <= last.getTime() && days.length < 366) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/** Did this day meet the goal? `total` goals aren't judged per day — only at the end. */
function dayMade(goal: ChallengeGoal, day: ChallengeDay | undefined): boolean {
  if (!day) return false;
  switch (goal.kind) {
    case 'streak':
      return day.workouts > 0;
    case 'daily':
      return day.points >= goal.points;
    case 'total':
      return day.workouts > 0; // shown for colour; it never costs an ante on its own
  }
}

/**
 * Where everyone stands (§7b). A day only counts against you once it is over, so "today" is
 * always still open — the same rule as the streak grid (§9e).
 *
 * The pot is reps: every missed day drops that player's ante into it. When the challenge ends,
 * everyone who missed at least one day shares the pot evenly — so a lone misser works off
 * exactly what they dropped, and a group of missers splits the lot.
 */
export function challengeStandings(state: ChallengeState, todayKey: string): ChallengeStandings {
  const { challenge, members, days } = state;
  const all = challengeDays(challenge);
  const gone = all.filter((day) => day < todayKey);
  const over = all.length > 0 && all[all.length - 1] < todayKey;
  const byPlayer = new Map<string, Map<string, ChallengeDay>>();
  for (const day of days) {
    const map = byPlayer.get(day.playerId) ?? new Map<string, ChallengeDay>();
    map.set(day.day, day);
    byPlayer.set(day.playerId, map);
  }

  const grid: ChallengeStandings['grid'] = {};
  const players = members.map((member) => {
    const mine = byPlayer.get(member.playerId) ?? new Map<string, ChallengeDay>();
    const points = all.reduce((n, day) => n + (mine.get(day)?.points ?? 0), 0);
    let made = 0;
    let missed = 0;
    grid[member.playerId] = all.map((day) => {
      const done = dayMade(challenge.goal, mine.get(day));
      if (done) made++;
      // A day you haven't reached yet — or today, which is still open — can't be a miss.
      else if (day < todayKey) missed++;
      return done ? 'made' : day < todayKey ? 'missed' : 'open';
    });
    // A `total` goal is one bet on the whole challenge: you owe your ante for every day only
    // if you finish short, so nothing is staked until the last day is gone.
    const short = challenge.goal.kind === 'total' && over && points < challenge.goal.points;
    const staked =
      challenge.goal.kind === 'total' ? (short ? challenge.ante * all.length : 0) : missed * challenge.ante;
    return {
      playerId: member.playerId,
      name: member.name,
      made,
      missed: challenge.goal.kind === 'total' ? (short ? 1 : 0) : missed,
      points,
      staked,
      owed: 0,
      clean: staked === 0,
      todayDone: dayMade(challenge.goal, mine.get(todayKey)),
    } satisfies PlayerStanding;
  });

  const pot = players.reduce((n, p) => n + p.staked, 0);
  const missers = players.filter((p) => p.staked > 0);
  if (over && missers.length) {
    const share = Math.round(pot / missers.length);
    for (const player of missers) player.owed = share;
  }

  return {
    days: all,
    daysGone: gone.length,
    pot,
    over,
    grid,
    players: players.sort((a, b) => a.missed - b.missed || b.points - a.points || a.name.localeCompare(b.name)),
  };
}

/** Where *you* stand, worked out from this device's own work — no network, so Home can show it. */
export interface OwnStatus {
  /** Before the first day. */
  upcoming: boolean;
  /** After the last day. */
  over: boolean;
  /** Today's requirement met (a `total` goal: the whole target reached). */
  todayDone: boolean;
  todayPoints: number;
  /** What today still needs, for a goal counted per day; 0 when it's met or not per-day. */
  todayShort: number;
  /** Days of the challenge still to come, today included. */
  daysLeft: number;
  /** Days already gone that you missed. */
  missed: number;
  /** Reps of yours already in the pot (a `total` goal stakes nothing until the end). */
  staked: number;
  /** Work across the challenge so far, and the target for a `total` goal. */
  points: number;
  target: number | null;
}

/**
 * The same rules as `challengeStandings`, for one player, from the work map a device already has
 * (§7b). Home uses it so a list of challenges costs one request, not one per challenge.
 */
export function ownStatus(challenge: Challenge, work: ReadonlyMap<string, WorkDay>, todayKey: string): OwnStatus {
  const days = challengeDays(challenge);
  const dayOf = (day: string): ChallengeDay | undefined => {
    const found = work.get(day);
    return found ? { playerId: 'me', day, points: found.points, workouts: found.workouts } : undefined;
  };
  const points = days.reduce((n, day) => n + (work.get(day)?.points ?? 0), 0);
  const missed = days.filter((day) => day < todayKey && !dayMade(challenge.goal, dayOf(day))).length;
  const over = days.length > 0 && days[days.length - 1] < todayKey;
  const target = challenge.goal.kind === 'total' ? challenge.goal.points : null;
  const todayPoints = work.get(todayKey)?.points ?? 0;
  const todayDone = target !== null ? points >= target : dayMade(challenge.goal, dayOf(todayKey));
  const short =
    challenge.goal.kind === 'daily' ? Math.max(0, challenge.goal.points - todayPoints) : target !== null ? Math.max(0, target - points) : 0;

  return {
    upcoming: challenge.startsOn > todayKey,
    over,
    todayDone,
    todayPoints,
    todayShort: todayDone ? 0 : short,
    daysLeft: days.filter((day) => day >= todayKey).length,
    missed,
    staked: target !== null ? (over && points < target ? challenge.ante * days.length : 0) : missed * challenge.ante,
    points,
    target,
  };
}
