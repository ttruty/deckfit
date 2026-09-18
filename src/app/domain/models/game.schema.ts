/**
 * Game definition DSL (CLAUDE.md §6.2). Built-in games (assets/content/games.json)
 * and user-built games share this schema and run on the same interpreter
 * (domain/engine/dsl). Objects are strict so typos in hand-written or imported
 * games fail loudly instead of being silently ignored.
 */
import { z } from 'zod';
import { JokerRuleSchema, PlayerRangeSchema, SuitSchema } from './schemas';

// ── References ──────────────────────────────────────────────────────────────

/** A value taken from the resolved game settings, e.g. `{ "setting": "matchOn" }`. */
export const SettingRefSchema = z.strictObject({ setting: z.string().min(1) });
export type SettingRef = z.infer<typeof SettingRefSchema>;

/** A game counter's current value (see the `incr` step), e.g. `{ "var": "row" }`; 0 if never set. */
export const VarRefSchema = z.strictObject({ var: z.string().min(1) });
export type VarRef = z.infer<typeof VarRefSchema>;

const orSetting = <T extends z.ZodType>(schema: T) => z.union([schema, SettingRefSchema]);
/** Numbers in steps and conditions may be literals, settings, or counters. */
const orRef = <T extends z.ZodType>(schema: T) => z.union([schema, SettingRefSchema, VarRefSchema]);
export type NumberRef = number | SettingRef | VarRef;

/**
 * Single zones. `hand`/`pile` mean the acting player's zone (the current player, or whoever sent
 * the intent). `team` is the actor's team's shared hand (games with `teams`).
 */
export const DSL_ZONES = ['draw', 'discard', 'table', 'hand', 'pile', 'team'] as const;
export const DslZoneSchema = z.enum(DSL_ZONES);
export type DslZone = z.infer<typeof DslZoneSchema>;

/** Every player's (or team's) zone, in seat/team order (selectors only): `piles.last` = each player's last pile card. */
export const PLAYER_ZONES = ['hands', 'piles', 'teams'] as const;
export const PlayerZonesSchema = z.enum(PLAYER_ZONES);
export type PlayerZones = z.infer<typeof PlayerZonesSchema>;

/** `first` = index 0 (top of draw), `last` = final card, `middle` = all but first and last, `all`. */
export const PICKS = ['first', 'last', 'middle', 'all'] as const;
/** `intent.card` = the card named by the intent being handled (actions only). */
export const SelectorSchema = z.union([
  z.templateLiteral([z.enum([...DSL_ZONES, ...PLAYER_ZONES]), '.', z.enum(PICKS)]),
  z.literal('intent.card'),
]);
export type Selector = z.infer<typeof SelectorSchema>;

const Selectors = z.union([SelectorSchema, z.array(SelectorSchema).min(1)]);
const Amount = orRef(z.number().int().nonnegative());

// ── Conditions ──────────────────────────────────────────────────────────────

export const MatchOnSchema = z.enum(['suit', 'rank', 'color', 'adjacent-rank']);
export type MatchOn = z.infer<typeof MatchOnSchema>;

/** Exactly one of these per count/var condition. */
export type Comparison = { lt?: NumberRef; lte?: NumberRef; eq?: NumberRef; gte?: NumberRef; gt?: NumberRef };
const comparison = { lt: Amount.optional(), lte: Amount.optional(), eq: Amount.optional(), gte: Amount.optional(), gt: Amount.optional() };
const oneComparison = (c: object) => ['lt', 'lte', 'eq', 'gte', 'gt'].filter((k) => k in c).length === 1;

export type Condition =
  | `${DslZone}.empty`
  | { anyEmpty: PlayerZones }
  | { flag: string }
  | { match: Selector[]; on: MatchOn | SettingRef }
  | { compare: [Selector, Selector]; wins: 'high' | 'low' }
  | ({ count: DslZone } & Comparison)
  | ({ var: string } & Comparison)
  | { elapsed: string }
  | { setting: string; equals: string | number | boolean }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

const ConditionList = z.lazy(() => z.array(ConditionSchema).min(1));

/** One schema per condition kind (the builder validates and explains a single condition with these). */
export const CONDITION_SCHEMAS = {
  empty: z.templateLiteral([DslZoneSchema, '.empty']),
  anyEmpty: z.strictObject({ anyEmpty: PlayerZonesSchema }),
  /** Engine flags: `betting` (a betting round is open), `claim-open`, `bluff:winner`. Any truthy var also works. */
  flag: z.strictObject({ flag: z.string().min(1) }),
  match: z.strictObject({ match: z.array(SelectorSchema).min(2), on: orSetting(MatchOnSchema) }),
  compare: z.strictObject({ compare: z.tuple([SelectorSchema, SelectorSchema]), wins: z.enum(['high', 'low']) }),
  count: z.strictObject({ count: DslZoneSchema, ...comparison }).refine(oneComparison, 'count needs exactly one comparison'),
  var: z.strictObject({ var: z.string().min(1), ...comparison }).refine(oneComparison, 'var needs exactly one comparison'),
  elapsed: z.strictObject({ elapsed: z.string().min(1) }),
  setting: z.strictObject({ setting: z.string().min(1), equals: z.union([z.string(), z.number(), z.boolean()]) }),
  all: z.strictObject({ all: ConditionList }),
  any: z.strictObject({ any: ConditionList }),
  not: z.strictObject({ not: z.lazy(() => ConditionSchema) }),
};
export type ConditionKind = keyof typeof CONDITION_SCHEMAS;

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    CONDITION_SCHEMAS.empty, CONDITION_SCHEMAS.anyEmpty, CONDITION_SCHEMAS.flag, CONDITION_SCHEMAS.match, CONDITION_SCHEMAS.compare,
    CONDITION_SCHEMAS.count, CONDITION_SCHEMAS.var, CONDITION_SCHEMAS.elapsed, CONDITION_SCHEMAS.setting,
    CONDITION_SCHEMAS.all, CONDITION_SCHEMAS.any, CONDITION_SCHEMAS.not,
  ]),
);

// ── Steps (primitives) ──────────────────────────────────────────────────────

/**
 * Long form of `assign`. `to`: `current` (the acting player, default), `each` (every player
 * gets all the cards), `winners`/`losers` (by the last `winners` step), `owner` (each card
 * goes to the player whose hand/pile it came from). `timedSec` sets timed tasks to that length.
 */
export const ASSIGN_TARGETS = ['current', 'each', 'winners', 'losers', 'owner'] as const;
export interface AssignSpec {
  cards: Selector | Selector[];
  to?: (typeof ASSIGN_TARGETS)[number];
  timedSec?: NumberRef;
}

/** Draw only cards whose exercise has this measure; others go to discard and are replaced. Jokers never qualify. */
export interface DrawFilter {
  measure: 'reps' | 'seconds';
}
const DrawFilterSchema = z.strictObject({ measure: z.enum(['reps', 'seconds']) });

export interface TimerSpec {
  id: string;
  kind: 'countdown' | 'interval';
  seconds: NumberRef;
  /** interval only: after `seconds` of work the same timer runs this many seconds of rest. */
  restSeconds?: NumberRef;
  label?: string;
}

export type Step =
  | { deal: { to: DslZone | PlayerZones; count: NumberRef; faceUp?: boolean; only?: DrawFilter } }
  | { flip: { to?: DslZone; only?: DrawFilter } }
  | { move: Selector | Selector[]; to: DslZone; faceUp?: boolean }
  | { refill: { zone: DslZone; to: NumberRef; faceUp?: boolean; only?: DrawFilter } }
  | { assign: Selector | Selector[] | AssignSpec }
  | { timer: TimerSpec }
  | { incr: string; by?: NumberRef }
  | { reset: string }
  | { winners: { cards: Selector; wins: 'high' | 'low' } | { cards: Selector; by: 'poker' } | { by: 'empty-team' } }
  | { reshuffle: true }
  | { reveal: Selector | Selector[] }
  | { startBetting: true }
  | { assignPot: { to: 'losers' } }
  | { turn: 'next' }
  | { if: Condition; then: Step[]; else?: Step[] }
  | { repeat: NumberRef; steps: Step[] };

const StepList = z.lazy(() => z.array(StepSchema));

/** One schema per primitive (the builder validates a single block with these). */
export const STEP_SCHEMAS = {
  deal: z.strictObject({
    deal: z.strictObject({
      to: z.union([DslZoneSchema, PlayerZonesSchema]), count: Amount, faceUp: z.boolean().optional(), only: DrawFilterSchema.optional(),
    }),
  }),
  flip: z.strictObject({ flip: z.strictObject({ to: DslZoneSchema.optional(), only: DrawFilterSchema.optional() }) }),
  move: z.strictObject({ move: Selectors, to: DslZoneSchema, faceUp: z.boolean().optional() }),
  refill: z.strictObject({
    refill: z.strictObject({ zone: DslZoneSchema, to: Amount, faceUp: z.boolean().optional(), only: DrawFilterSchema.optional() }),
  }),
  assign: z.strictObject({
    assign: z.union([
      Selectors,
      z.strictObject({ cards: Selectors, to: z.enum(ASSIGN_TARGETS).optional(), timedSec: orRef(z.number().int().positive()).optional() }),
    ]),
  }),
  timer: z.strictObject({
    timer: z
      .strictObject({
        id: z.string().min(1),
        kind: z.enum(['countdown', 'interval']),
        seconds: orRef(z.number().int().positive()),
        restSeconds: orRef(z.number().int().positive()).optional(),
        label: z.string().optional(),
      })
      .refine((t) => t.kind === 'interval' || t.restSeconds === undefined, { message: 'restSeconds is only for interval timers', path: ['restSeconds'] }),
  }),
  incr: z.strictObject({ incr: z.string().min(1), by: Amount.optional() }),
  reset: z.strictObject({ reset: z.string().min(1) }),
  winners: z.strictObject({
    winners: z.union([
      z.strictObject({ cards: SelectorSchema, wins: z.enum(['high', 'low']) }),
      z.strictObject({ cards: SelectorSchema, by: z.literal('poker') }),
      z.strictObject({ by: z.literal('empty-team') }),
    ]),
  }),
  reshuffle: z.strictObject({ reshuffle: z.literal(true) }),
  reveal: z.strictObject({ reveal: Selectors }),
  startBetting: z.strictObject({ startBetting: z.literal(true) }),
  assignPot: z.strictObject({ assignPot: z.strictObject({ to: z.literal('losers') }) }),
  turn: z.strictObject({ turn: z.literal('next') }),
  if: z.strictObject({ if: ConditionSchema, then: StepList, else: StepList.optional() }),
  repeat: z.strictObject({ repeat: orRef(z.number().int().positive().max(1000)), steps: z.lazy(() => z.array(StepSchema).min(1)) }),
};
export type StepKind = keyof typeof STEP_SCHEMAS;
export const STEP_KINDS = Object.keys(STEP_SCHEMAS) as StepKind[];

export const StepSchema: z.ZodType<Step> = z.lazy(() =>
  z.union([
    STEP_SCHEMAS.deal, STEP_SCHEMAS.flip, STEP_SCHEMAS.move, STEP_SCHEMAS.refill, STEP_SCHEMAS.assign, STEP_SCHEMAS.timer,
    STEP_SCHEMAS.incr, STEP_SCHEMAS.reset, STEP_SCHEMAS.winners, STEP_SCHEMAS.reshuffle, STEP_SCHEMAS.reveal,
    STEP_SCHEMAS.startBetting, STEP_SCHEMAS.assignPot, STEP_SCHEMAS.turn, STEP_SCHEMAS.if, STEP_SCHEMAS.repeat,
  ]),
);

// ── User-tunable settings (drive the generated routine settings form) ───────

const settingMeta = { label: z.string().optional(), help: z.string().optional() };

export const SettingDefSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('enum'), options: z.array(z.string().min(1)).min(1), default: z.string(), ...settingMeta })
    .refine((s) => s.options.includes(s.default), { message: 'default must be one of options', path: ['default'] }),
  z.strictObject({
    type: z.literal('number'), min: z.number(), max: z.number(), step: z.number().positive().optional(),
    default: z.number().nullable(), // null = off (e.g. no time cap)
    ...settingMeta,
  }).refine((s) => s.min <= s.max && (s.default === null || (s.default >= s.min && s.default <= s.max)), {
    message: 'default must be within min..max', path: ['default'],
  }),
  z.strictObject({ type: z.literal('boolean'), default: z.boolean(), ...settingMeta }),
  z.strictObject({ type: z.literal('suits'), default: z.array(SuitSchema).min(1), ...settingMeta }),
]);
export type SettingDef = z.infer<typeof SettingDefSchema>;

// ── Game definition ─────────────────────────────────────────────────────────

/** total-work: 1 point per rep, 1 per 5 seconds. rounds-won: 1 point per RoundWon. */
export const ScoringSchema = z.enum(['total-work', 'rounds-won']);
export type Scoring = z.infer<typeof ScoringSchema>;

/**
 * Core GameSettings every routine form shows; a game sets their defaults via `defaults`
 * and may not redeclare them in settingsSchema. The optional core keys `timeLimitSec`
 * and `rounds` are the exception: a game opts in by declaring them in settingsSchema.
 */
export const CORE_SETTING_KEYS = ['repMultiplier', 'faceCardValue', 'aceValue', 'jokerRule', 'maxRepCap', 'players'] as const;
const OPTIONAL_CORE_KEYS = ['timeLimitSec', 'rounds'] as const;

export const GameDefinitionSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9-]+$/, 'lowercase letters, digits, and dashes'),
    name: z.string().min(1),
    summary: z.string().min(1),
    players: PlayerRangeSchema,
    setup: z.strictObject({
      /** Keep only cards whose suit is in this list (removed cards leave play). */
      filter: z.strictObject({ suits: orSetting(z.array(SuitSchema).min(1)) }).optional(),
      shuffle: z.boolean(),
      deal: z.array(StepSchema),
    }),
    /**
     * Omit for action-only games. Sequential: each `flip` by the current player runs `steps`.
     * Simultaneous: each player's `flip` runs `each` as that player; once all have acted, `then` runs.
     */
    turn: z
      .union([
        z.strictObject({ steps: z.array(StepSchema).min(1) }),
        z.strictObject({ mode: z.literal('simultaneous'), each: z.array(StepSchema).min(1), then: z.array(StepSchema) }),
      ])
      .optional(),
    /** Free intents any player may send at any time (while they have no pending tasks). */
    actions: z
      .strictObject({
        play: z.strictObject({ require: z.array(z.strictObject({ when: ConditionSchema, reason: z.string().min(1) })).optional(), steps: z.array(StepSchema) }).optional(),
        pass: z.strictObject({ require: z.array(z.strictObject({ when: ConditionSchema, reason: z.string().min(1) })).optional(), steps: z.array(StepSchema) }).optional(),
      })
      .optional(),
    /** The first player to finish all of a round's tasks (none skipped) wins that round. */
    race: z.boolean().optional(),
    /**
     * Rotating judge (§6.3 rep-race): one player per round sits out — they get no tasks and may
     * mark anyone else's task done or skipped. Usually wired to a boolean setting.
     */
    judge: z.union([z.boolean(), SettingRefSchema]).optional(),
    /** Betting rounds (`startBetting` opens one; `bet`/`call`/`pass` in turn; `then` runs when it closes). */
    betting: z.strictObject({ maxBet: Amount, then: z.array(StepSchema) }).optional(),
    /** Bluff rules: `claim` 1..maxCards face down as the required rank (A→K cycling); others may `call`. */
    bluff: z.strictObject({ maxCards: z.number().int().min(1).max(8) }).optional(),
    /** Teams of `size`, interleaved by seat; each team shares its captain's hand (`team`/`teams` zones). */
    teams: z.strictObject({ size: z.number().int().min(2).max(4) }).optional(),
    /**
     * Hands and face-down cards are private: the host sends each player only their redacted view,
     * encrypted (§7). Required for betting/bluff games.
     */
    hidden: z.boolean().optional(),
    /** `then` runs once when `when` first holds (e.g. assign leftovers); GameOver follows when its tasks are done. */
    end: z.strictObject({ when: ConditionSchema, then: z.array(StepSchema).optional() }),
    scoring: ScoringSchema,
    /** For the host (§7): hold these intents `windowMs`, then apply by corrected send time, then seat. */
    timing: z.strictObject({ windowMs: z.number().int().min(0).max(2000), intents: z.array(z.enum(['play', 'pass', 'flip', 'completeTask'])).min(1) }).optional(),
    /** Defaults for core settings; anything omitted falls back to BASE_SETTINGS. */
    defaults: z
      .strictObject({
        repMultiplier: z.number().min(0.5).max(3).optional(),
        faceCardValue: z.number().int().nonnegative().optional(),
        aceValue: z.number().int().nonnegative().optional(),
        jokerRule: JokerRuleSchema.optional(),
        maxRepCap: z.number().int().positive().optional(),
        timeLimitSec: z.number().int().positive().optional(),
        rounds: z.number().int().positive().optional(),
      })
      .optional(),
    settingsSchema: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/), SettingDefSchema),
    builtIn: z.boolean(),
  })
  .superRefine((g, ctx) => {
    for (const key of Object.keys(g.settingsSchema)) {
      if ((CORE_SETTING_KEYS as readonly string[]).includes(key))
        ctx.addIssue({ code: 'custom', path: ['settingsSchema', key], message: `${key} is a core setting; use defaults` });
    }
    // Every { setting } reference must resolve to a declared or core setting.
    const declared = new Set<string>([...CORE_SETTING_KEYS, ...OPTIONAL_CORE_KEYS, ...Object.keys(g.settingsSchema)]);
    for (const key of OPTIONAL_CORE_KEYS) {
      const s = g.settingsSchema[key];
      if (s && s.type !== 'number')
        ctx.addIssue({ code: 'custom', path: ['settingsSchema', key], message: `${key} must be a number setting` });
    }
    const walk = (node: unknown, path: (string | number)[]) => {
      if (Array.isArray(node)) return node.forEach((n, i) => walk(n, [...path, i]));
      if (!node || typeof node !== 'object') return;
      const rec = node as Record<string, unknown>;
      if (typeof rec['setting'] === 'string' && !declared.has(rec['setting']))
        ctx.addIssue({ code: 'custom', path: [...path, 'setting'], message: `unknown setting "${rec['setting']}"` });
      for (const [k, v] of Object.entries(rec)) walk(v, [...path, k]);
    };
    walk(g.setup, ['setup']);
    walk(g.turn, ['turn']);
    walk(g.actions, ['actions']);
    walk(g.end, ['end']);
    if (!g.turn && !g.actions && !g.bluff) ctx.addIssue({ code: 'custom', path: ['turn'], message: 'a game needs a turn, actions, or bluff rules' });
    walk(g.betting, ['betting']);
    if ((g.betting || g.bluff) && !g.hidden) ctx.addIssue({ code: 'custom', path: ['hidden'], message: 'betting and bluff games must be hidden (private hands)' });
  });
export type GameDefinition = z.infer<typeof GameDefinitionSchema>;

export const GamesFileSchema = z.object({ version: z.number().int().positive(), games: z.array(GameDefinitionSchema) });
export type GamesFile = z.infer<typeof GamesFileSchema>;
