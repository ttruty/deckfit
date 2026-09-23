import { z } from 'zod';

/**
 * §7b async challenges: a wager between friends that runs over days. Everything here is data
 * that lives in Supabase (see `supabase/migrations`), so it is Zod-validated on the way in and
 * out — rows come from a public table and are never trusted as typed.
 */

/** Join code, like a room's: six unambiguous characters. */
export const ChallengeCodeSchema = z.string().regex(/^[A-Z0-9]{6}$/);

/** A local calendar day, `YYYY-MM-DD` (challenges are counted in the player's own days). */
export const DayKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * What the challenge asks for, as the creator set it:
 * - `streak` — a workout every day;
 * - `daily` — at least `points` of work every day (1 per rep, 1 per 5 seconds, §6.1);
 * - `total` — `points` of work across the whole challenge, any day you like.
 */
export const ChallengeGoalSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('streak') }),
  z.strictObject({ kind: z.literal('daily'), points: z.number().int().min(1).max(10_000) }),
  z.strictObject({ kind: z.literal('total'), points: z.number().int().min(1).max(1_000_000) }),
]);
export type ChallengeGoal = z.infer<typeof ChallengeGoalSchema>;

export const ChallengeSchema = z.object({
  id: z.string().min(1),
  code: ChallengeCodeSchema,
  name: z.string().min(1).max(60),
  goal: ChallengeGoalSchema,
  /** Reps each player puts on the line per day. Missing a day drops yours into the pot. */
  ante: z.number().int().min(1).max(500),
  startsOn: DayKeySchema,
  endsOn: DayKeySchema,
  createdBy: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
});
export type Challenge = z.infer<typeof ChallengeSchema>;

export const ChallengeMemberSchema = z.object({
  playerId: z.string().min(1),
  name: z.string().min(1).max(40),
  joinedAt: z.number().int().nonnegative(),
});
export type ChallengeMember = z.infer<typeof ChallengeMemberSchema>;

/** One player's work on one day, as their own device reported it. */
export const ChallengeDaySchema = z.object({
  playerId: z.string().min(1),
  day: DayKeySchema,
  /** Card-value scale: 1 per rep, 1 per 5 seconds held (§6.1). */
  points: z.number().int().nonnegative(),
  workouts: z.number().int().nonnegative(),
});
export type ChallengeDay = z.infer<typeof ChallengeDaySchema>;

/** Everything about one challenge, as a device holds it. */
export interface ChallengeState {
  challenge: Challenge;
  members: ChallengeMember[];
  days: ChallengeDay[];
}

/** Human summary of a goal, for headings and the join screen. */
export function goalText(goal: ChallengeGoal): string {
  switch (goal.kind) {
    case 'streak':
      return 'A workout every day';
    case 'daily':
      return `${goal.points} points of work every day`;
    case 'total':
      return `${goal.points} points of work before it ends`;
  }
}
