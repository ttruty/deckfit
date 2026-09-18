import { z } from 'zod';
import { IntentTypeSchema } from './intents';
import { PlayerIdSchema, TaskSchema, TimerSchema, ZoneIdSchema } from './state';

const CardIds = z.array(z.string().min(1));

/** Facts emitted by the reducer; they drive UI animation and form the session log (§6.1). */
export const EngineEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('GameStarted'), players: z.array(PlayerIdSchema) }),
  z.object({ type: z.literal('CardsShuffled'), zone: ZoneIdSchema, count: z.number().int().nonnegative() }),
  z.object({ type: z.literal('CardsDealt'), zone: ZoneIdSchema, cardIds: CardIds, faceUp: z.boolean() }),
  z.object({ type: z.literal('CardFlipped'), zone: ZoneIdSchema, cardId: z.string() }),
  z.object({ type: z.literal('CardPlayed'), playerId: PlayerIdSchema, cardId: z.string(), zone: ZoneIdSchema }),
  z.object({ type: z.literal('CardsMoved'), from: ZoneIdSchema, to: ZoneIdSchema, cardIds: CardIds }),
  z.object({ type: z.literal('TaskAssigned'), task: TaskSchema }),
  z.object({
    type: z.literal('TaskCompleted'),
    taskId: z.string(),
    playerId: PlayerIdSchema,
    /** Totals key: exerciseId, or the joker kind ('wild' when no choice, 'bonus-cardio', 'rest'). */
    exerciseKey: z.string(),
    amount: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal('TaskSkipped'), taskId: z.string(), playerId: PlayerIdSchema }),
  z.object({ type: z.literal('TimerStarted'), timer: TimerSchema }),
  /** For interval timers `phase` says which phase ended; a 'work' end is followed by TimerStarted for rest. */
  z.object({ type: z.literal('TimerElapsed'), timerId: z.string(), phase: z.enum(['work', 'rest']).optional() }),
  z.object({ type: z.literal('TurnStarted'), playerId: PlayerIdSchema, round: z.number().int().nonnegative() }),
  z.object({ type: z.literal('RoundWon'), playerId: PlayerIdSchema, round: z.number().int().nonnegative() }),
  /** Betting (§6.3 fit-poker). `amount` is the player's total stake this hand. */
  z.object({ type: z.literal('BetPlaced'), playerId: PlayerIdSchema, amount: z.number().int().nonnegative(), pot: z.number().int().nonnegative() }),
  z.object({ type: z.literal('PlayerChecked'), playerId: PlayerIdSchema }),
  z.object({ type: z.literal('PlayerFolded'), playerId: PlayerIdSchema }),
  /** Bluff games: a face-down claim (the cards stay hidden). */
  z.object({ type: z.literal('ClaimMade'), playerId: PlayerIdSchema, rank: z.string(), count: z.number().int().positive() }),
  z.object({
    type: z.literal('ClaimChallenged'), playerId: PlayerIdSchema, claimant: PlayerIdSchema, lied: z.boolean(), loser: PlayerIdSchema,
  }),
  /** Cards turned face up for everyone (showdown, challenged claim). */
  z.object({ type: z.literal('CardsRevealed'), cardIds: CardIds }),
  /** A player dropped out mid-game (left the room); their cards were discarded. */
  z.object({ type: z.literal('PlayerLeft'), playerId: PlayerIdSchema }),
  z.object({ type: z.literal('GameOver'), reason: z.string(), scores: z.record(PlayerIdSchema, z.number()) }),
  z.object({
    type: z.literal('IntentRejected'),
    playerId: PlayerIdSchema,
    intent: IntentTypeSchema,
    reason: z.string(),
  }),
]);
export type EngineEvent = z.infer<typeof EngineEventSchema>;
export type EngineEventType = EngineEvent['type'];
