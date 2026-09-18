import { z } from 'zod';
import { MeasureSchema } from '../models/schemas';

export const PlayerIdSchema = z.string().min(1);
export type PlayerId = z.infer<typeof PlayerIdSchema>;

const CardId = z.string().min(1);
const Count = z.number().int().nonnegative();

/** Zone references: shared zones, or per-player zones as `hand:<playerId>` / `pile:<playerId>`. */
export const ZoneIdSchema = z.union([
  z.enum(['draw', 'discard', 'table']),
  z.templateLiteral(['hand:', PlayerIdSchema]),
  z.templateLiteral(['pile:', PlayerIdSchema]),
]);
export type ZoneId = z.infer<typeof ZoneIdSchema>;

export const TaskKindSchema = z.enum(['exercise', 'wild', 'rest', 'bonus-cardio']);
export type TaskKind = z.infer<typeof TaskKindSchema>;

/** An assigned piece of work (§6.1). One task per exercise per assignment. */
export const TaskSchema = z.object({
  id: z.string().min(1),
  playerId: PlayerIdSchema,
  cardIds: z.array(CardId).min(1),
  kind: TaskKindSchema,
  exerciseId: z.string().min(1).nullable(), // null for joker tasks
  amount: z.number().int().positive(), // multiplied, rounded, capped
  measure: MeasureSchema,
  status: z.enum(['pending', 'done', 'skipped']),
});
export type Task = z.infer<typeof TaskSchema>;

/**
 * Timers are data; the UI measures time and dispatches `timerElapsed`.
 * `durationSec` is always the length of the current phase. Interval timers start in
 * phase 'work'; when work elapses they restart in phase 'rest' with `durationSec = restSec`.
 * Only the end of rest counts as elapsed.
 */
export const TimerSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['countdown', 'interval']),
  durationSec: z.number().int().positive(),
  restSec: z.number().int().positive().optional(),
  phase: z.enum(['work', 'rest']).optional(),
  label: z.string().optional(),
});
export type Timer = z.infer<typeof TimerSchema>;

export const GameStateSchema = z.object({
  phase: z.enum(['setup', 'playing', 'finished']),
  /** mulberry32 state; kept in state (not ctx) so snapshots resume the same shuffles. */
  rngState: z.number().int().nonnegative(),
  /** `left` players stay listed (seats, teams, history) but are out of `turn.order`. */
  players: z.array(z.object({ id: PlayerIdSchema, seat: Count, left: z.boolean().optional() })),
  turn: z.object({ order: z.array(PlayerIdSchema), index: Count, round: Count, step: Count }),
  zones: z.object({
    draw: z.array(CardId),
    discard: z.array(CardId),
    table: z.array(CardId),
    hands: z.record(PlayerIdSchema, z.array(CardId)),
    piles: z.record(PlayerIdSchema, z.array(CardId)),
  }),
  faceUp: z.array(CardId),
  timers: z.array(TimerSchema),
  scores: z.record(PlayerIdSchema, z.number()),
  tasks: z.array(TaskSchema),
  /** Work done: playerId → (exerciseId | 'wild' | 'bonus-cardio') → reps or seconds. Mirrors Session.totals. */
  totals: z.record(PlayerIdSchema, z.record(z.string(), z.number().nonnegative())),
  /** Monotonic counter for task/timer ids, so ids are deterministic. */
  nextId: Count,
  /** Game-specific scratch values (DSL settings snapshot, round counters). */
  vars: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});
export type GameState = z.infer<typeof GameStateSchema>;
