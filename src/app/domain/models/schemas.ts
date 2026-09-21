/**
 * Domain model (CLAUDE.md §5) as Zod schemas; every TS type is z.infer'd from here.
 * Framework-free: shared by forms, Dexie, import/export, network messages, and tools.
 */
import { z } from 'zod';

// ── Primitives ──────────────────────────────────────────────────────────────

export const SUITS = ['hearts', 'diamonds', 'clubs', 'spades', 'joker'] as const;
export const SuitSchema = z.enum(SUITS);
export type Suit = z.infer<typeof SuitSchema>;

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'JOKER'] as const;
export const RankSchema = z.enum(RANKS);
export type Rank = z.infer<typeof RankSchema>;

export const MuscleGroupSchema = z.enum([
  'legs', 'arms', 'chest', 'shoulders', 'back', 'core', 'cardio', 'full-body', 'mobility',
]);
export type MuscleGroup = z.infer<typeof MuscleGroupSchema>;

export const EquipmentSchema = z.enum(['none', 'dumbbell', 'kettlebell', 'barbell', 'band', 'ball', 'suspension', 'mat']);
export type Equipment = z.infer<typeof EquipmentSchema>;

export const ExerciseCategorySchema = z.enum([
  'bodyweight', 'dumbbell', 'kettlebell', 'barbell', 'band', 'ball', 'suspension', 'flexibility', 'yoga', 'running',
]);
export type ExerciseCategory = z.infer<typeof ExerciseCategorySchema>;

export const MeasureSchema = z.enum(['reps', 'seconds']);
export type Measure = z.infer<typeof MeasureSchema>;

export const DifficultySchema = z.literal([1, 2, 3, 4, 5]);
export type Difficulty = z.infer<typeof DifficultySchema>;

const Id = z.string().min(1);
const Timestamp = z.number().int().nonnegative();

// ── Pictograms (§9a; rendered by shared/ui/exercise-figure/figure-geometry.ts) ─

export const PtSchema = z.tuple([z.number(), z.number()]);
export type Pt = z.infer<typeof PtSchema>;

/** Joint coordinates in a 100×100 box, ground at y=90. n* = near limbs, f* = far limbs. */
export const PoseSchema = z.object({
  head: PtSchema, neck: PtSchema, hip: PtSchema,
  nE: PtSchema, nH: PtSchema, fE: PtSchema, fH: PtSchema,
  nK: PtSchema, nF: PtSchema, fK: PtSchema, fF: PtSchema,
});
export type Pose = z.infer<typeof PoseSchema>;

export const PoseLibrarySchema = z.record(Id, PoseSchema);
export type PoseLibrary = z.infer<typeof PoseLibrarySchema>;

export const BandAnchorSchema = z.enum(['feet', 'front', 'behind', 'above', 'knees', 'hands']);
export type BandAnchor = z.infer<typeof BandAnchorSchema>;
export const BAND_ANCHORS = BandAnchorSchema.options;

export const PropSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.enum(['dumbbell', 'kettlebell', 'barbell']) }),
    z.object({ type: z.literal('band'), anchor: BandAnchorSchema }),
    z.object({ type: z.literal('ball'), x: z.number(), y: z.number(), r: z.number().positive() }),
    z.object({ type: z.literal('strap'), attach: z.enum(['hands', 'feet']), anchorX: z.number().optional() }),
  ])
  .nullable();
export type Prop = z.infer<typeof PropSchema>;

export const FigureSpecSchema = z.object({ start: Id, end: Id, prop: PropSchema });
export type FigureSpec = z.infer<typeof FigureSpecSchema>;

// ── Exercises, cards, decks ─────────────────────────────────────────────────

export const ExerciseSchema = z.object({
  id: Id,
  name: z.string().min(1),
  description: z.string(),
  cues: z.array(z.string()).optional(),
  category: ExerciseCategorySchema,
  muscleGroups: z.array(MuscleGroupSchema).min(1),
  equipment: z.array(EquipmentSchema).min(1),
  difficulty: DifficultySchema,
  measure: MeasureSchema,
  figure: FigureSpecSchema,
  adaptive: z.object({ seated: z.boolean().optional(), lowImpact: z.boolean().optional(), notes: z.string().optional() }).optional(),
  mediaUrl: z.url().optional(),
  builtIn: z.boolean(),
});
export type Exercise = z.infer<typeof ExerciseSchema>;

/** Jokers are exactly the cards with suit 'joker', rank 'JOKER', and no exercise. */
export const CardSchema = z
  .object({
    id: Id,
    suit: SuitSchema,
    rank: RankSchema,
    exerciseId: Id.nullable(),
    baseAmount: z.number().int().nonnegative(),
  })
  .superRefine((c, ctx) => {
    const joker = c.suit === 'joker';
    if (joker !== (c.rank === 'JOKER')) ctx.addIssue({ code: 'custom', path: ['rank'], message: 'rank JOKER must pair with suit joker' });
    if (joker !== (c.exerciseId === null)) ctx.addIssue({ code: 'custom', path: ['exerciseId'], message: 'only jokers have no exercise' });
  });
export type Card = z.infer<typeof CardSchema>;

export const SuitMappingSchema = z.object({
  suit: SuitSchema,
  label: z.string().min(1),
  color: z.string().min(1), // theme token, e.g. "suit-hearts"
  muscleGroups: z.array(MuscleGroupSchema),
});
export type SuitMapping = z.infer<typeof SuitMappingSchema>;

export const DeckSchema = z
  .object({
    id: Id,
    name: z.string().min(1),
    category: ExerciseCategorySchema.optional(),
    suits: z.array(SuitMappingSchema).min(1),
    cards: z.array(CardSchema).min(1),
    builtIn: z.boolean(),
    basedOn: Id.optional(),
    updatedAt: Timestamp,
  })
  .superRefine((d, ctx) => {
    const ids = new Set<string>();
    d.cards.forEach((c, i) => {
      if (ids.has(c.id)) ctx.addIssue({ code: 'custom', path: ['cards', i, 'id'], message: `duplicate card id ${c.id}` });
      ids.add(c.id);
      if (!d.suits.some((s) => s.suit === c.suit))
        ctx.addIssue({ code: 'custom', path: ['cards', i, 'suit'], message: `no suit mapping for ${c.suit}` });
    });
  });
export type Deck = z.infer<typeof DeckSchema>;

// ── Games, routines, sessions ───────────────────────────────────────────────

export const JokerRuleSchema = z.enum(['skip', 'wild', 'rest', 'bonus-cardio']);
export type JokerRule = z.infer<typeof JokerRuleSchema>;

/** How hard the workout is: scales every task's reps and held seconds (§6.1). */
export const INTENSITIES = ['low', 'moderate', 'high'] as const;
export const IntensitySchema = z.enum(INTENSITIES);
export type Intensity = z.infer<typeof IntensitySchema>;

export const PlayerRangeSchema = z
  .object({ min: z.number().int().min(1), max: z.number().int().min(1) })
  .refine((p) => p.min <= p.max, { message: 'min must not exceed max', path: ['max'] });
export type PlayerRange = z.infer<typeof PlayerRangeSchema>;

/** Known settings are typed; game-specific keys pass through and are checked by the game's settingsSchema. */
export const GameSettingsSchema = z.looseObject({
  intensity: IntensitySchema.optional(), // absent on records saved before intensity: read as 'moderate'
  repMultiplier: z.number().min(0.5).max(3),
  faceCardValue: z.number().int().nonnegative(),
  aceValue: z.number().int().nonnegative(),
  jokerRule: JokerRuleSchema,
  maxRepCap: z.number().int().positive().optional(), // §12: per-task cap on the multiplied amount
  timeLimitSec: z.number().int().positive().optional(),
  rounds: z.number().int().positive().optional(),
  players: PlayerRangeSchema,
});
export type GameSettings = z.infer<typeof GameSettingsSchema>;

/** Play-time deck filters; semantics in deck-rules.ts applyDeckFilters. */
export const DeckFiltersSchema = z.object({
  suits: z.array(SuitSchema).optional(),
  maxDifficulty: DifficultySchema.optional(),
  equipment: z.array(EquipmentSchema).optional(),
});
export type DeckFilters = z.infer<typeof DeckFiltersSchema>;

export const RoutineSchema = z.object({
  id: Id,
  name: z.string().min(1),
  deckId: Id,
  gameId: Id,
  settings: GameSettingsSchema,
  deckFilters: DeckFiltersSchema.optional(),
  favorite: z.boolean(),
  updatedAt: Timestamp,
});
export type Routine = z.infer<typeof RoutineSchema>;

/**
 * Session log entry. Loose on purpose: the engine owns the event union
 * (domain/engine) and validates payloads; storage only needs the type tag.
 */
export const LoggedEventSchema = z.looseObject({ type: z.string().min(1) });
export type LoggedEvent = z.infer<typeof LoggedEventSchema>;

/** Deck as played: filters applied, labels as they were. Keeps history and replay independent of later edits. */
export const DeckSnapshotSchema = z.object({
  id: Id,
  name: z.string().min(1),
  suits: z.array(SuitMappingSchema),
  cards: z.array(CardSchema),
});
export type DeckSnapshot = z.infer<typeof DeckSnapshotSchema>;

export const SessionPlayerSchema = z.object({ id: Id, name: z.string().min(1) });
export type SessionPlayer = z.infer<typeof SessionPlayerSchema>;

export const SessionSchema = z.object({
  id: Id,
  routineId: Id.optional(),
  roomId: Id.optional(),
  /** Which entry in `players` is this device (multiplayer); defaults to the first. */
  playerId: Id.optional(),
  seed: z.number().int().nonnegative(),
  startedAt: Timestamp,
  endedAt: Timestamp.optional(),
  /** finished = GameOver reached; abandoned = ended early by the player. Absent while in progress. */
  outcome: z.enum(['finished', 'abandoned']).optional(),
  game: z.object({ id: Id, name: z.string().min(1) }),
  deck: DeckSnapshotSchema,
  settings: GameSettingsSchema,
  players: z.array(SessionPlayerSchema).min(1),
  log: z.array(LoggedEventSchema),
  /** Intents applied so far, in order: replaying them from `seed` restores an in-progress game. */
  intents: z.array(z.looseObject({ type: z.string().min(1), playerId: Id })).optional(),
  totals: z.record(Id /* playerId */, z.record(Id /* exerciseId */, z.number().nonnegative())),
});
export type Session = z.infer<typeof SessionSchema>;

// ── Content files (src/assets/content, generated by tools/build_content.py) ─

export const ExercisesFileSchema = z.object({ version: z.number().int().positive(), exercises: z.array(ExerciseSchema) });
export const DecksFileSchema = z.object({ version: z.number().int().positive(), decks: z.array(DeckSchema) });
export type ExercisesFile = z.infer<typeof ExercisesFileSchema>;
export type DecksFile = z.infer<typeof DecksFileSchema>;
