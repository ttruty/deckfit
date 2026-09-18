import type { Card, Deck, Exercise, GameSettings } from '../models/schemas';
import { planTasks } from './amounts';
import type { EngineEvent } from './events';
import type { Intent } from './intents';
import type { GameState, PlayerId, Task, ZoneId } from './state';

export interface Step {
  state: GameState;
  events: EngineEvent[];
}

/** Everything the reducer reads but never changes. */
export interface EngineContext {
  settings: GameSettings;
  cardsById: ReadonlyMap<string, Card>;
  exercisesById: ReadonlyMap<string, Pick<Exercise, 'id' | 'measure'>>;
  rules: GameRules;
}

/** Game-specific behavior. The DSL interpreter implements this; so can test doubles. */
export interface GameRules {
  /** Handles every intent except completeTask/skipTask. */
  apply(state: GameState, intent: Intent, ctx: EngineContext): Step;
  /** Runs after a task is completed or skipped (`task` as it is now), e.g. to decide a race or end the game. */
  afterTask?(state: GameState, ctx: EngineContext, task: Task): Step;
  /** Runs after a player leaves, e.g. to close a round the rest have already finished. */
  afterLeave?(state: GameState, ctx: EngineContext): Step;
  /** May `actor` complete or skip someone else's task? (A judge may.) */
  canActFor?(state: GameState, actor: PlayerId, task: Task, ctx: EngineContext): boolean;
}

export function createContext(
  deck: Pick<Deck, 'cards'>,
  exercises: readonly Pick<Exercise, 'id' | 'measure'>[],
  settings: GameSettings,
  rules: GameRules,
): EngineContext {
  return {
    settings,
    cardsById: new Map(deck.cards.map((c) => [c.id, c])),
    exercisesById: new Map(exercises.map((e) => [e.id, e])),
    rules,
  };
}

/** Fresh state: every deck card in the draw pile, in deck order (games shuffle during setup). */
export function createInitialState(opts: { players: readonly PlayerId[]; seed: number; deck: Pick<Deck, 'cards'> }): GameState {
  const { players, seed, deck } = opts;
  if (players.length === 0) throw new Error('createInitialState: need at least one player');
  if (new Set(players).size !== players.length) throw new Error('createInitialState: duplicate player id');
  const perPlayer = () => Object.fromEntries(players.map((p) => [p, [] as string[]]));
  return {
    phase: 'setup',
    rngState: seed >>> 0,
    players: players.map((id, seat) => ({ id, seat })),
    turn: { order: [...players], index: 0, round: 0, step: 0 },
    zones: { draw: deck.cards.map((c) => c.id), discard: [], table: [], hands: perPlayer(), piles: perPlayer() },
    faceUp: [],
    timers: [],
    scores: Object.fromEntries(players.map((p) => [p, 0])),
    tasks: [],
    totals: Object.fromEntries(players.map((p) => [p, {}])),
    nextId: 1,
    vars: {},
  };
}

/**
 * A player drops out (§7 resilience): they leave the turn order, their pending tasks are skipped,
 * and their hand and pile go face down to the discard pile so the cards aren't lost. They stay in
 * `players` (marked `left`) so seats, teams, scores and history keep their shape.
 */
function leave(state: GameState, playerId: PlayerId, ctx: EngineContext): Step {
  if (!state.turn.order.includes(playerId)) return reject(state, { type: 'leave', playerId }, 'not-playing');
  const events: EngineEvent[] = [{ type: 'PlayerLeft', playerId }];
  let s: GameState = {
    ...state,
    players: state.players.map((p) => (p.id === playerId ? { ...p, left: true } : p)),
    tasks: state.tasks.map((t) => (t.playerId === playerId && t.status === 'pending' ? { ...t, status: 'skipped' as const } : t)),
  };
  for (const zone of [`hand:${playerId}`, `pile:${playerId}`] as const) {
    const cards = getZone(s, zone);
    if (!cards.length) continue;
    s = transferCards(s, zone, 'discard', cards, false);
    events.push({ type: 'CardsMoved', from: zone, to: 'discard', cardIds: [...cards] });
  }
  const order = s.turn.order.filter((id) => id !== playerId);
  // Keep the turn on the same player where possible; wrap when the leaver was last.
  const removed = s.turn.order.indexOf(playerId);
  const index = order.length === 0 ? 0 : Math.min(s.turn.index > removed ? s.turn.index - 1 : s.turn.index, order.length - 1);
  s = { ...s, turn: { ...s.turn, order, index } };
  void ctx;
  return { state: s, events };
}

/** Pure: never mutates `state`. Invalid intents yield an IntentRejected event and the same state. */
export function reduce(state: GameState, intent: Intent, ctx: EngineContext): Step {
  if (state.phase === 'finished') return reject(state, intent, 'game-over');
  if (!state.players.some((p) => p.id === intent.playerId)) return reject(state, intent, 'unknown-player');

  switch (intent.type) {
    case 'completeTask':
    case 'skipTask': {
      const step = intent.type === 'completeTask' ? completeTask(state, intent, ctx) : skipTask(state, intent, ctx);
      if (!ctx.rules.afterTask || step.events.some((e) => e.type === 'IntentRejected')) return step;
      const task = step.state.tasks.find((t) => t.id === intent.taskId)!;
      return chain(step, (s) => ctx.rules.afterTask!(s, ctx, task));
    }
    case 'leave': {
      const step = leave(state, intent.playerId, ctx);
      if (!ctx.rules.afterLeave || step.events.some((e) => e.type === 'IntentRejected')) return step;
      return chain(step, (s) => ctx.rules.afterLeave!(s, ctx));
    }
    default:
      return ctx.rules.apply(state, intent, ctx);
  }
}

// ── Task lifecycle (game-agnostic) ──────────────────────────────────────────

function findPendingTask(state: GameState, intent: { playerId: string; taskId: string }, ctx: EngineContext): Task | string {
  const task = state.tasks.find((t) => t.id === intent.taskId);
  if (!task) return 'unknown-task';
  if (task.status !== 'pending') return 'task-not-pending';
  if (task.playerId !== intent.playerId && !ctx.rules.canActFor?.(state, intent.playerId, task, ctx)) return 'not-your-task';
  return task;
}

function completeTask(state: GameState, intent: Extract<Intent, { type: 'completeTask' }>, ctx: EngineContext): Step {
  const task = findPendingTask(state, intent, ctx);
  if (typeof task === 'string') return reject(state, intent, task);
  if (intent.exerciseId !== undefined) {
    if (task.kind !== 'wild') return reject(state, intent, 'exercise-choice-not-allowed');
    if (!ctx.exercisesById.has(intent.exerciseId)) return reject(state, intent, 'unknown-exercise');
  }

  const amount = intent.amount ?? task.amount;
  const exerciseKey = task.exerciseId ?? (task.kind === 'wild' ? (intent.exerciseId ?? 'wild') : task.kind);
  const tasks = state.tasks.map((t) => (t.id === task.id ? { ...t, status: 'done' as const } : t));
  // Rest is recovery, not work: it completes the task but never counts toward totals.
  const totals =
    task.kind === 'rest'
      ? state.totals
      : addTotal(state.totals, task.playerId, exerciseKey, amount);

  return {
    state: { ...state, tasks, totals },
    events: [{ type: 'TaskCompleted', taskId: task.id, playerId: task.playerId, exerciseKey, amount }],
  };
}

function skipTask(state: GameState, intent: Extract<Intent, { type: 'skipTask' }>, ctx: EngineContext): Step {
  const task = findPendingTask(state, intent, ctx);
  if (typeof task === 'string') return reject(state, intent, task);
  return {
    state: { ...state, tasks: state.tasks.map((t) => (t.id === task.id ? { ...t, status: 'skipped' as const } : t)) },
    events: [{ type: 'TaskSkipped', taskId: task.id, playerId: task.playerId }],
  };
}

function addTotal(totals: GameState['totals'], playerId: string, key: string, amount: number): GameState['totals'] {
  const mine = totals[playerId] ?? {};
  return { ...totals, [playerId]: { ...mine, [key]: (mine[key] ?? 0) + amount } };
}

// ── Helpers shared with game rules (the DSL interpreter) ────────────────────

export function reject(state: GameState, intent: Intent, reason: string): Step {
  return { state, events: [{ type: 'IntentRejected', playerId: intent.playerId, intent: intent.type, reason }] };
}

/** Runs `next` on the state from `step` and concatenates events. */
export function chain(step: Step, next: (state: GameState) => Step): Step {
  const out = next(step.state);
  return { state: out.state, events: [...step.events, ...out.events] };
}

export function pendingTasks(state: GameState, playerId?: PlayerId): Task[] {
  return state.tasks.filter((t) => t.status === 'pending' && (playerId === undefined || t.playerId === playerId));
}

export function getZone(state: GameState, zone: ZoneId): readonly string[] {
  if (zone === 'draw' || zone === 'discard' || zone === 'table') return state.zones[zone];
  const [kind, playerId] = splitPlayerZone(zone);
  const cards = state.zones[kind === 'hand' ? 'hands' : 'piles'][playerId];
  if (!cards) throw new Error(`getZone: unknown player in ${zone}`);
  return cards;
}

export function setZone(state: GameState, zone: ZoneId, cards: readonly string[]): GameState {
  if (zone === 'draw' || zone === 'discard' || zone === 'table') return { ...state, zones: { ...state.zones, [zone]: [...cards] } };
  const [kind, playerId] = splitPlayerZone(zone);
  const key = kind === 'hand' ? 'hands' : 'piles';
  if (!state.zones[key][playerId]) throw new Error(`setZone: unknown player in ${zone}`);
  return { ...state, zones: { ...state.zones, [key]: { ...state.zones[key], [playerId]: [...cards] } } };
}

function splitPlayerZone(zone: `hand:${string}` | `pile:${string}`): ['hand' | 'pile', string] {
  const i = zone.indexOf(':');
  return [zone.slice(0, i) as 'hand' | 'pile', zone.slice(i + 1)];
}

/**
 * Moves `cardIds` (which must all be in `from`) to the end of `to`, without events.
 * `faceUp` true/false sets their face-up status explicitly. When omitted, cards moved
 * onto the table keep their current status and cards moved anywhere else turn face-down.
 */
export function transferCards(state: GameState, from: ZoneId, to: ZoneId, cardIds: readonly string[], faceUp?: boolean): GameState {
  if (cardIds.length === 0) return state;
  const source = getZone(state, from);
  const missing = cardIds.filter((id) => !source.includes(id));
  if (missing.length) throw new Error(`moveCards: ${missing.join(',')} not in ${from}`);
  const moving = new Set(cardIds);
  let next = setZone(state, from, source.filter((id) => !moving.has(id)));
  next = setZone(next, to, [...getZone(next, to), ...cardIds]);
  const others = next.faceUp.filter((id) => !moving.has(id));
  const faceUpIds =
    faceUp === true ? [...others, ...cardIds] : faceUp === false || to !== 'table' ? others : next.faceUp;
  return { ...next, faceUp: faceUpIds };
}

/** Moves `cardIds` (which must all be in `from`) to the end of `to` and emits CardsMoved. */
export function moveCards(state: GameState, from: ZoneId, to: ZoneId, cardIds: readonly string[]): Step {
  if (cardIds.length === 0) return { state, events: [] };
  return { state: transferCards(state, from, to, cardIds), events: [{ type: 'CardsMoved', from, to, cardIds: [...cardIds] }] };
}

/**
 * One task for `playerId` doing `card`'s exercise for `reps` points (×5 seconds when timed),
 * capped by maxRepCap; no multiplier (the amount was agreed in play, e.g. a poker pot). No task for 0.
 */
export function assignAmount(state: GameState, playerId: PlayerId, cardId: string, reps: number, ctx: EngineContext): Step {
  const card = ctx.cardsById.get(cardId);
  const measure = card?.exerciseId ? ctx.exercisesById.get(card.exerciseId)?.measure : undefined;
  if (!card?.exerciseId || !measure || reps <= 0) return { state, events: [] };
  const unit = measure === 'seconds' ? 5 : 1;
  const cap = ctx.settings.maxRepCap === undefined ? Number.POSITIVE_INFINITY : ctx.settings.maxRepCap * unit;
  const task: Task = {
    id: `t${state.nextId}`, playerId, cardIds: [cardId], kind: 'exercise', exerciseId: card.exerciseId,
    amount: Math.min(reps * unit, cap), measure, status: 'pending',
  };
  return { state: { ...state, tasks: [...state.tasks, task], nextId: state.nextId + 1 }, events: [{ type: 'TaskAssigned', task }] };
}

/**
 * Creates tasks for `playerId` from `cardIds` using the amount rules; emits TaskAssigned per task.
 * `timedSeconds`: timed exercise and bonus-cardio tasks last exactly this long (a work window;
 * not multiplied or capped). Rest tasks keep their own length.
 */
export function assignTasks(
  state: GameState,
  playerId: PlayerId,
  cardIds: readonly string[],
  ctx: EngineContext,
  opts: { timedSeconds?: number } = {},
): Step {
  const cards = cardIds.map((id) => {
    const card = ctx.cardsById.get(id);
    if (!card) throw new Error(`assignTasks: unknown card ${id}`);
    return card;
  });
  const drafts = planTasks(cards, {
    settings: ctx.settings,
    measureOf: (exerciseId) => ctx.exercisesById.get(exerciseId)?.measure,
  });
  let nextId = state.nextId;
  const tasks: Task[] = drafts.map((d) => ({
    ...d,
    ...(opts.timedSeconds !== undefined && d.measure === 'seconds' && d.kind !== 'rest' ? { amount: opts.timedSeconds } : {}),
    id: `t${nextId++}`,
    playerId,
    status: 'pending',
  }));
  return {
    state: { ...state, tasks: [...state.tasks, ...tasks], nextId },
    events: tasks.map((task) => ({ type: 'TaskAssigned', task })),
  };
}
