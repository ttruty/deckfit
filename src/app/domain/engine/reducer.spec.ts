import type { Card, GameSettings } from '../models/schemas';
import { EngineEventSchema } from './events';
import type { Intent } from './intents';
import {
  assignTasks, createContext, createInitialState, moveCards, reduce, type EngineContext, type GameRules,
} from './reducer';
import { GameStateSchema, type GameState } from './state';

const cards: Card[] = [
  { id: 'h2', suit: 'hearts', rank: '2', exerciseId: 'squat', baseAmount: 2 },
  { id: 'h3', suit: 'hearts', rank: '3', exerciseId: 'squat', baseAmount: 3 },
  { id: 's4', suit: 'spades', rank: '4', exerciseId: 'plank', baseAmount: 20 },
  { id: 'jk', suit: 'joker', rank: 'JOKER', exerciseId: null, baseAmount: 0 },
];
const exercises = [{ id: 'squat', measure: 'reps' as const }, { id: 'plank', measure: 'seconds' as const }];
const settings: GameSettings = { repMultiplier: 1, faceCardValue: 10, aceValue: 11, jokerRule: 'wild', players: { min: 1, max: 2 } };

const noRules: GameRules = { apply: (state, intent) => ({ state, events: [{ type: 'IntentRejected', playerId: intent.playerId, intent: intent.type, reason: 'not-supported' }] }) };

function setup(rules: GameRules = noRules): { state: GameState; ctx: EngineContext } {
  const ctx = createContext({ cards }, exercises, settings, rules);
  const state = createInitialState({ players: ['p1', 'p2'], seed: 7, deck: { cards } });
  return { state: assignTasks(state, 'p1', ['h2', 's4', 'h3', 'jk'], ctx).state, ctx };
}

const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === 'object') {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
};

describe('createInitialState', () => {
  it('produces schema-valid state with the deck in the draw pile', () => {
    const s = createInitialState({ players: ['a', 'b'], seed: 42, deck: { cards } });
    expect(GameStateSchema.parse(s)).toEqual(s);
    expect(s.zones.draw).toEqual(['h2', 'h3', 's4', 'jk']);
    expect(s.players).toEqual([{ id: 'a', seat: 0 }, { id: 'b', seat: 1 }]);
    expect(s.rngState).toBe(42);
  });

  it('rejects empty or duplicate players', () => {
    expect(() => createInitialState({ players: [], seed: 1, deck: { cards } })).toThrow();
    expect(() => createInitialState({ players: ['a', 'a'], seed: 1, deck: { cards } })).toThrow();
  });
});

describe('assignTasks', () => {
  it('creates deterministic task ids and emits TaskAssigned per task', () => {
    const ctx = createContext({ cards }, exercises, settings, noRules);
    const s0 = createInitialState({ players: ['p1'], seed: 1, deck: { cards } });
    const { state, events } = assignTasks(s0, 'p1', ['h2', 's4', 'h3', 'jk'], ctx);
    expect(state.tasks.map((t) => [t.id, t.exerciseId, t.amount, t.measure, t.kind])).toEqual([
      ['t1', 'squat', 5, 'reps', 'exercise'],
      ['t2', 'plank', 20, 'seconds', 'exercise'],
      ['t3', null, 10, 'reps', 'wild'],
    ]);
    expect(state.nextId).toBe(4);
    expect(events.map((e) => e.type)).toEqual(['TaskAssigned', 'TaskAssigned', 'TaskAssigned']);
    events.forEach((e) => expect(EngineEventSchema.parse(e)).toEqual(e));
  });
});

describe('reduce: tasks', () => {
  const complete = (taskId: string, extra: Partial<Extract<Intent, { type: 'completeTask' }>> = {}): Intent => ({
    type: 'completeTask', playerId: 'p1', taskId, ...extra,
  });

  it('completes a task, adds to totals, and never mutates the input', () => {
    const { state, ctx } = setup();
    deepFreeze(state);
    const step = reduce(state, complete('t1'), ctx);
    expect(step.events).toEqual([{ type: 'TaskCompleted', taskId: 't1', playerId: 'p1', exerciseKey: 'squat', amount: 5 }]);
    expect(step.state.tasks.find((t) => t.id === 't1')?.status).toBe('done');
    expect(step.state.totals['p1']).toEqual({ squat: 5 });
  });

  it('logs the amount actually done when given', () => {
    const { state, ctx } = setup();
    expect(reduce(state, complete('t2', { amount: 12 }), ctx).state.totals['p1']).toEqual({ plank: 12 });
  });

  it('records a wild task under the chosen exercise, or "wild" without a choice', () => {
    const { state, ctx } = setup();
    expect(reduce(state, complete('t3', { exerciseId: 'plank' }), ctx).state.totals['p1']).toEqual({ plank: 10 });
    expect(reduce(state, complete('t3'), ctx).state.totals['p1']).toEqual({ wild: 10 });
  });

  it('does not count rest toward totals', () => {
    const ctx = createContext({ cards }, exercises, { ...settings, jokerRule: 'rest' }, noRules);
    const s = assignTasks(createInitialState({ players: ['p1'], seed: 1, deck: { cards } }), 'p1', ['jk'], ctx).state;
    const step = reduce(s, complete('t1'), ctx);
    expect(step.events[0]).toMatchObject({ type: 'TaskCompleted', exerciseKey: 'rest', amount: 30 });
    expect(step.state.totals['p1']).toEqual({});
  });

  it('skips a task without touching totals', () => {
    const { state, ctx } = setup();
    const step = reduce(state, { type: 'skipTask', playerId: 'p1', taskId: 't1' }, ctx);
    expect(step.events).toEqual([{ type: 'TaskSkipped', taskId: 't1', playerId: 'p1' }]);
    expect(step.state.tasks[0].status).toBe('skipped');
    expect(step.state.totals['p1']).toEqual({});
  });

  it.each<[string, Intent, string]>([
    ['unknown task', { type: 'completeTask', playerId: 'p1', taskId: 't99' }, 'unknown-task'],
    ['someone else’s task', { type: 'completeTask', playerId: 'p2', taskId: 't1' }, 'not-your-task'],
    ['unknown player', { type: 'completeTask', playerId: 'zz', taskId: 't1' }, 'unknown-player'],
    ['exercise choice on a normal task', { type: 'completeTask', playerId: 'p1', taskId: 't1', exerciseId: 'plank' }, 'exercise-choice-not-allowed'],
    ['unknown wild exercise', { type: 'completeTask', playerId: 'p1', taskId: 't3', exerciseId: 'nope' }, 'unknown-exercise'],
  ])('rejects %s', (_label, intent, reason) => {
    const { state, ctx } = setup();
    const step = reduce(state, intent, ctx);
    expect(step.state).toBe(state);
    expect(step.events).toEqual([{ type: 'IntentRejected', playerId: intent.playerId, intent: intent.type, reason }]);
  });

  it('rejects completing a task twice', () => {
    const { state, ctx } = setup();
    const once = reduce(state, complete('t1'), ctx).state;
    expect(reduce(once, complete('t1'), ctx).events[0]).toMatchObject({ reason: 'task-not-pending' });
  });

  it('runs rules.afterTask after a successful task intent only', () => {
    const afterTask = vi.fn((state: GameState) => ({ state: { ...state, vars: { after: true } }, events: [] }));
    const { state, ctx } = setup({ ...noRules, afterTask });
    expect(reduce(state, complete('t1'), ctx).state.vars).toEqual({ after: true });
    reduce(state, complete('t99'), ctx);
    expect(afterTask).toHaveBeenCalledTimes(1);
  });
});

describe('reduce: dispatch', () => {
  it('delegates non-task intents to the game rules', () => {
    const apply = vi.fn((state: GameState) => ({ state, events: [] }));
    const { state, ctx } = setup({ apply });
    reduce(state, { type: 'flip', playerId: 'p2' }, ctx);
    expect(apply).toHaveBeenCalledWith(state, { type: 'flip', playerId: 'p2' }, ctx);
  });

  it('rejects everything once the game is finished', () => {
    const { state, ctx } = setup();
    const step = reduce({ ...state, phase: 'finished' }, { type: 'flip', playerId: 'p1' }, ctx);
    expect(step.events).toEqual([{ type: 'IntentRejected', playerId: 'p1', intent: 'flip', reason: 'game-over' }]);
  });
});

describe('moveCards', () => {
  it('moves cards between zones, clears face-up off the table, and emits CardsMoved', () => {
    const s0 = { ...createInitialState({ players: ['p1'], seed: 1, deck: { cards } }), faceUp: ['h2'] };
    const toTable = moveCards(s0, 'draw', 'table', ['h2', 'h3']);
    expect(toTable.state.zones.table).toEqual(['h2', 'h3']);
    expect(toTable.state.faceUp).toEqual(['h2']);
    const toHand = moveCards(toTable.state, 'table', 'hand:p1', ['h2']);
    expect(toHand.state.zones.hands['p1']).toEqual(['h2']);
    expect(toHand.state.faceUp).toEqual([]);
    expect(toHand.events).toEqual([{ type: 'CardsMoved', from: 'table', to: 'hand:p1', cardIds: ['h2'] }]);
  });

  it('throws when a card is not in the source zone', () => {
    const s0 = createInitialState({ players: ['p1'], seed: 1, deck: { cards } });
    expect(() => moveCards(s0, 'table', 'discard', ['h2'])).toThrow(/not in table/);
  });
});
