import { z } from 'zod';
import { PlayerIdSchema } from './state';

export const IntentTypeSchema = z.enum([
  'deal', 'flip', 'play', 'claim', 'bet', 'call', 'pass', 'completeTask', 'skipTask', 'timerElapsed', 'nextRound', 'leave',
]);

const base = { playerId: PlayerIdSchema };

/** Everything a player (or the UI on their behalf) can ask the engine to do (§6.1). */
export const IntentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('deal'), ...base }),
  z.object({ type: z.literal('flip'), ...base }),
  z.object({ type: z.literal('play'), ...base, cardId: z.string().min(1) }),
  /** Bluff games: place these cards face down as the required rank. */
  z.object({ type: z.literal('claim'), ...base, cardIds: z.array(z.string().min(1)).min(1).max(8) }),
  z.object({ type: z.literal('bet'), ...base, amount: z.number().int().positive() }),
  z.object({ type: z.literal('call'), ...base }),
  z.object({ type: z.literal('pass'), ...base }),
  z.object({
    type: z.literal('completeTask'),
    ...base,
    taskId: z.string().min(1),
    /** Work actually logged (e.g. reps achieved in an interval); defaults to the task amount. */
    amount: z.number().int().nonnegative().optional(),
    /** Only for wild tasks: the exercise the player chose. */
    exerciseId: z.string().min(1).optional(),
  }),
  z.object({ type: z.literal('skipTask'), ...base, taskId: z.string().min(1) }),
  z.object({ type: z.literal('timerElapsed'), ...base, timerId: z.string().min(1) }),
  z.object({ type: z.literal('nextRound'), ...base }),
  /** The player is out: their cards go to the discard pile and the game carries on without them (§7). */
  z.object({ type: z.literal('leave'), ...base }),
]);
export type Intent = z.infer<typeof IntentSchema>;
export type IntentType = Intent['type'];
/** An intent without its playerId (the sender fills it in). Distributes over the union. */
export type IntentInput = Intent extends infer I ? (I extends Intent ? Omit<I, 'playerId'> : never) : never;
