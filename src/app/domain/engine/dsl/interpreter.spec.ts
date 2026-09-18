import { GameDefinitionSchema, type Condition, type GameDefinition, type Step as DslStep } from '../../models/game.schema';
import type { Card, GameSettings, Rank, Suit } from '../../models/schemas';
import { EngineEventSchema } from '../events';
import type { Intent } from '../intents';
import { createContext, createInitialState, reduce, type EngineContext } from '../reducer';
import type { GameState } from '../state';
import { cardsMatch, counter, createDslRules, currentPlayer, evaluate, runSteps, select } from './interpreter';
import { resolveSettings } from './settings';

// ── Fixtures ────────────────────────────────────────────────────────────────

const c = (suit: Suit, rank: Rank, exerciseId: string | null = suit === 'joker' ? null : 'squat'): Card => ({
  id: `${suit[0]}${rank}`, suit, rank, exerciseId, baseAmount: Number(rank) || (rank === 'JOKER' ? 0 : 10),
});
const CARDS: Card[] = [
  c('hearts', '2'), c('hearts', '3'), c('spades', '4', 'plank'), c('diamonds', '5'),
  c('clubs', '6'), c('hearts', 'K'), c('spades', 'A', 'plank'), c('joker', 'JOKER'),
];
const EXERCISES = [{ id: 'squat', measure: 'reps' as const }, { id: 'plank', measure: 'seconds' as const }];

function game(over: Partial<GameDefinition> = {}): GameDefinition {
  return GameDefinitionSchema.parse({
    id: 'test', name: 'Test', summary: 'Test game', players: { min: 1, max: 4 },
    setup: { shuffle: false, deal: [] },
    turn: { steps: [{ flip: {} }, { assign: 'table.last' }] },
    end: { when: 'draw.empty' },
    scoring: 'total-work',
    settingsSchema: {},
    builtIn: false,
    ...over,
  });
}

function harness(def: GameDefinition, opts: { players?: string[]; settings?: Partial<GameSettings>; cards?: Card[] } = {}) {
  const cards = opts.cards ?? CARDS;
  const settings = resolveSettings(def, opts.settings);
  const ctx = createContext({ cards }, EXERCISES, settings, createDslRules(def));
  let state = createInitialState({ players: opts.players ?? ['p1'], seed: 1, deck: { cards } });
  const log: unknown[] = [];
  return {
    ctx,
    get state() { return state; },
    set state(s: GameState) { state = s; },
    dispatch(intent: Intent) {
      const step = reduce(state, intent, ctx);
      step.events.forEach((e) => expect(EngineEventSchema.parse(e)).toEqual(e));
      state = step.state;
      log.push(...step.events);
      return step;
    },
    run(steps: DslStep[]) {
      const step = runSteps({ state, events: [] }, steps, ctx);
      state = step.state;
      return step;
    },
    log,
  };
}

/** Puts cards straight onto zones for condition/selector tests. */
function withZones(h: ReturnType<typeof harness>, zones: Partial<GameState['zones']>) {
  h.state = { ...h.state, phase: 'playing', zones: { ...h.state.zones, ...zones } };
}

const types = (events: { type: string }[]) => events.map((e) => e.type);

// ── Schema ──────────────────────────────────────────────────────────────────

describe('GameDefinitionSchema', () => {
  const base = { ...game() } as Record<string, unknown>;

  it('rejects unknown keys (typos) in steps', () => {
    expect(GameDefinitionSchema.safeParse({ ...base, turn: { steps: [{ flip: {}, extra: 1 }] } }).success).toBe(false);
    expect(GameDefinitionSchema.safeParse({ ...base, turn: { steps: [{ asign: 'table.all' }] } }).success).toBe(false);
  });

  it('rejects bad selectors and unsupported primitives', () => {
    expect(GameDefinitionSchema.safeParse({ ...base, turn: { steps: [{ assign: 'table.second' }] } }).success).toBe(false);
    expect(GameDefinitionSchema.safeParse({ ...base, turn: { steps: [{ bet: {} }] } }).success).toBe(false);
  });

  it('rejects setting references that are not declared', () => {
    const r = GameDefinitionSchema.safeParse({ ...base, setup: { shuffle: true, deal: [{ deal: { to: 'table', count: { setting: 'nope' } } }] } });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(['setup', 'deal', 0, 'deal', 'count', 'setting']);
  });

  it('forbids redeclaring always-present core settings but allows timeLimitSec as a number', () => {
    const redeclare = { repMultiplier: { type: 'number', min: 1, max: 2, default: 1 } };
    expect(GameDefinitionSchema.safeParse({ ...base, settingsSchema: redeclare }).success).toBe(false);
    const cap = { timeLimitSec: { type: 'number', min: 60, max: 600, default: null } };
    expect(GameDefinitionSchema.safeParse({ ...base, settingsSchema: cap }).success).toBe(true);
    const badCap = { timeLimitSec: { type: 'boolean', default: false } };
    expect(GameDefinitionSchema.safeParse({ ...base, settingsSchema: badCap }).success).toBe(false);
  });

  it('checks setting defaults against their options and range', () => {
    expect(GameDefinitionSchema.safeParse({ ...base, settingsSchema: { m: { type: 'enum', options: ['a'], default: 'b' } } }).success).toBe(false);
    expect(GameDefinitionSchema.safeParse({ ...base, settingsSchema: { n: { type: 'number', min: 1, max: 3, default: 5 } } }).success).toBe(false);
  });

  it('requires exactly one comparison in count', () => {
    const cond = (when: unknown) => GameDefinitionSchema.safeParse({ ...base, end: { when } }).success;
    expect(cond({ count: 'table', lt: 2 })).toBe(true);
    expect(cond({ count: 'table' })).toBe(false);
    expect(cond({ count: 'table', lt: 2, gt: 0 })).toBe(false);
  });
});

describe('resolveSettings', () => {
  const def = game({
    defaults: { faceCardValue: 8 },
    settingsSchema: {
      matchOn: { type: 'enum', options: ['suit', 'rank'], default: 'suit' },
      timeLimitSec: { type: 'number', min: 60, max: 600, default: null },
    },
  });

  it('layers base → game defaults → setting defaults → overrides', () => {
    const s = resolveSettings(def, { aceValue: 14 });
    expect(s).toMatchObject({ repMultiplier: 1, faceCardValue: 8, aceValue: 14, jokerRule: 'rest', matchOn: 'suit', players: { min: 1, max: 4 } });
    expect('timeLimitSec' in s).toBe(false); // null default = off
  });

  it('treats null overrides as "off" and validates game-specific values', () => {
    expect(resolveSettings(def, { timeLimitSec: null } as never).timeLimitSec).toBeUndefined();
    expect(resolveSettings(def, { timeLimitSec: 120 }).timeLimitSec).toBe(120);
    expect(() => resolveSettings(def, { matchOn: 'color' })).toThrow(/matchOn/);
    expect(() => resolveSettings(def, { timeLimitSec: 5 })).toThrow(/timeLimitSec/);
  });
});

// ── Flow ────────────────────────────────────────────────────────────────────

describe('game flow', () => {
  it('deal runs setup once: GameStarted, then deal steps; phase becomes playing', () => {
    const h = harness(game({ setup: { shuffle: false, deal: [{ deal: { to: 'table', count: 2 } }] } }));
    const step = h.dispatch({ type: 'deal', playerId: 'p1' });
    expect(types(step.events)).toEqual(['GameStarted', 'CardsDealt']);
    expect(h.state.phase).toBe('playing');
    expect(h.dispatch({ type: 'deal', playerId: 'p1' }).events[0]).toMatchObject({ reason: 'already-dealt' });
  });

  it('shuffle is deterministic per seed and advances rngState', () => {
    const def = game({ setup: { shuffle: true, deal: [] } });
    const a = harness(def);
    const b = harness(def);
    a.dispatch({ type: 'deal', playerId: 'p1' });
    b.dispatch({ type: 'deal', playerId: 'p1' });
    expect(a.state.zones.draw).toEqual(b.state.zones.draw);
    expect(a.state.zones.draw).not.toEqual(CARDS.map((x) => x.id));
    expect(a.state.rngState).not.toBe(1);
  });

  it('setup filter keeps only the chosen suits', () => {
    const def = game({
      setup: { filter: { suits: { setting: 'suits' } }, shuffle: false, deal: [] },
      settingsSchema: { suits: { type: 'suits', default: ['hearts', 'diamonds', 'clubs', 'spades', 'joker'] } },
    });
    const h = harness(def, { settings: { suits: ['hearts', 'joker'] } });
    h.dispatch({ type: 'deal', playerId: 'p1' });
    expect(h.state.zones.draw).toEqual(['h2', 'h3', 'hK', 'jJOKER']);
  });

  it.each<[string, Partial<GameState>, Intent, string]>([
    ['flip before deal', {}, { type: 'flip', playerId: 'p1' }, 'not-dealt'],
    ['flip on someone else’s turn', { phase: 'playing' }, { type: 'flip', playerId: 'p2' }, 'not-your-turn'],
    ['unsupported intent', { phase: 'playing' }, { type: 'bet', playerId: 'p1', amount: 3 }, 'not-supported'],
    ['unknown timer', { phase: 'playing' }, { type: 'timerElapsed', playerId: 'p1', timerId: 'x' }, 'unknown-timer'],
  ])('rejects %s', (_label, patch, intent, reason) => {
    const h = harness(game(), { players: ['p1', 'p2'] });
    h.state = { ...h.state, ...patch };
    expect(h.dispatch(intent).events).toEqual([{ type: 'IntentRejected', playerId: intent.playerId, intent: intent.type, reason }]);
  });

  it('rejects flip while tasks are pending, then allows it once done', () => {
    const h = harness(game());
    h.dispatch({ type: 'deal', playerId: 'p1' });
    h.dispatch({ type: 'flip', playerId: 'p1' });
    expect(h.dispatch({ type: 'flip', playerId: 'p1' }).events[0]).toMatchObject({ reason: 'tasks-pending' });
    h.dispatch({ type: 'completeTask', playerId: 'p1', taskId: 't1' });
    expect(types(h.dispatch({ type: 'flip', playerId: 'p1' }).events)).toEqual(['CardFlipped', 'TaskAssigned']);
  });

  it('checks end.when only when no tasks are pending, and scores total work', () => {
    const cards = [c('hearts', '7'), { ...c('spades', '3', 'plank'), baseAmount: 15 }]; // 7 reps, 15 seconds
    const h = harness(game(), { cards });
    h.dispatch({ type: 'deal', playerId: 'p1' });
    h.dispatch({ type: 'flip', playerId: 'p1' });
    h.dispatch({ type: 'completeTask', playerId: 'p1', taskId: 't1' });
    const last = h.dispatch({ type: 'flip', playerId: 'p1' }); // draw now empty, but t2 is pending
    expect(h.state.zones.draw).toEqual([]);
    expect(types(last.events)).toEqual(['CardFlipped', 'TaskAssigned']);
    const over = h.dispatch({ type: 'completeTask', playerId: 'p1', taskId: 't2' });
    expect(over.events.at(-1)).toEqual({ type: 'GameOver', reason: 'end', scores: { p1: 7 + 3 } });
    expect(h.state.phase).toBe('finished');
  });

  it('a time cap ends the game after the task in progress', () => {
    const def = game({
      setup: { shuffle: false, deal: [{ timer: { id: 'cap', kind: 'countdown', seconds: { setting: 'timeLimitSec' } } }] },
      end: { when: { any: ['draw.empty', { elapsed: 'cap' }] } },
      settingsSchema: { timeLimitSec: { type: 'number', min: 60, max: 600, default: null } },
    });
    const h = harness(def, { settings: { timeLimitSec: 60 } });
    expect(types(h.dispatch({ type: 'deal', playerId: 'p1' }).events)).toEqual(['GameStarted', 'TimerStarted']);
    h.dispatch({ type: 'flip', playerId: 'p1' });
    expect(types(h.dispatch({ type: 'timerElapsed', playerId: 'p1', timerId: 'cap' }).events)).toEqual(['TimerElapsed']);
    expect(types(h.dispatch({ type: 'completeTask', playerId: 'p1', taskId: 't1' }).events)).toEqual(['TaskCompleted', 'GameOver']);
  });

  it('skips the timer step when its setting is off', () => {
    const def = game({
      setup: { shuffle: false, deal: [{ timer: { id: 'cap', kind: 'countdown', seconds: { setting: 'timeLimitSec' } } }] },
      settingsSchema: { timeLimitSec: { type: 'number', min: 60, max: 600, default: null } },
    });
    const h = harness(def);
    expect(types(h.dispatch({ type: 'deal', playerId: 'p1' }).events)).toEqual(['GameStarted']);
  });

  it('ends immediately after a turn that assigns nothing (e.g. last card a skipped joker)', () => {
    const h = harness(game(), { cards: [c('joker', 'JOKER')], settings: { jokerRule: 'skip' } });
    h.dispatch({ type: 'deal', playerId: 'p1' });
    expect(types(h.dispatch({ type: 'flip', playerId: 'p1' }).events)).toEqual(['CardFlipped', 'GameOver']);
  });
});

// ── Primitives ──────────────────────────────────────────────────────────────

describe('primitives', () => {
  const playing = (opts?: Parameters<typeof harness>[1]) => {
    const h = harness(game(), opts);
    h.state = { ...h.state, phase: 'playing' };
    return h;
  };

  it('deal: from the top of draw; table face-up by default, hands face-down', () => {
    const h = playing();
    const step = h.run([{ deal: { to: 'table', count: 2 } }, { deal: { to: 'hand', count: 1 } }]);
    expect(step.events).toEqual([
      { type: 'CardsDealt', zone: 'table', cardIds: ['h2', 'h3'], faceUp: true },
      { type: 'CardsDealt', zone: 'hand:p1', cardIds: ['s4'], faceUp: false },
    ]);
    expect(h.state.faceUp).toEqual(['h2', 'h3']);
  });

  it('deal to "hands": one card at a time round-robin, stopping when draw runs out', () => {
    const h = playing({ players: ['p1', 'p2', 'p3'], cards: CARDS.slice(0, 5) });
    h.run([{ deal: { to: 'hands', count: 2 } }]);
    // h2 h3 s4 d5 c6 → round 1: p1 h2, p2 h3, p3 s4; round 2: p1 d5, p2 c6, draw empty.
    expect(h.state.zones.hands).toEqual({ p1: ['h2', 'd5'], p2: ['h3', 'c6'], p3: ['s4'] });
  });

  it('flip: moves the top card face-up (no-op on empty draw)', () => {
    const h = playing({ cards: CARDS.slice(0, 1) });
    expect(h.run([{ flip: {} }]).events).toEqual([{ type: 'CardFlipped', zone: 'table', cardId: 'h2' }]);
    expect(h.state.faceUp).toEqual(['h2']);
    expect(h.run([{ flip: {} }]).events).toEqual([]);
  });

  it('move: groups by source zone, dedupes, skips same-zone moves, turns cards face-down off the table', () => {
    const h = playing();
    withZones(h, { draw: ['c6'], table: ['h2', 'h3'], hands: { p1: ['s4'] } });
    h.state = { ...h.state, faceUp: ['h2', 'h3'] };
    const step = h.run([{ move: ['table.first', 'table.all', 'hand.all', 'discard.all'], to: 'discard' }]);
    expect(step.events).toEqual([
      { type: 'CardsMoved', from: 'table', to: 'discard', cardIds: ['h2', 'h3'] },
      { type: 'CardsMoved', from: 'hand:p1', to: 'discard', cardIds: ['s4'] },
    ]);
    expect(h.state.faceUp).toEqual([]);
  });

  it('refill: tops a zone up to the target, as far as the draw allows', () => {
    const h = playing({ cards: CARDS.slice(0, 3) });
    withZones(h, { draw: ['h3', 's4'], table: ['h2'] });
    expect(h.run([{ refill: { zone: 'table', to: 4 } }]).events).toEqual([
      { type: 'CardsDealt', zone: 'table', cardIds: ['h3', 's4'], faceUp: true },
    ]);
    expect(h.run([{ refill: { zone: 'table', to: 2 } }]).events).toEqual([]);
  });

  it('assign: tasks go to the current player; first+last of a one-card row is one card', () => {
    const h = playing({ players: ['p1', 'p2'] });
    withZones(h, { table: ['hK'] });
    h.state = { ...h.state, turn: { ...h.state.turn, index: 1 } };
    const step = h.run([{ assign: ['table.first', 'table.last'] }]);
    expect(step.events).toEqual([{
      type: 'TaskAssigned',
      task: { id: 't1', playerId: 'p2', cardIds: ['hK'], kind: 'exercise', exerciseId: 'squat', amount: 10, measure: 'reps', status: 'pending' },
    }]);
    expect(h.run([{ assign: 'discard.all' }]).events).toEqual([]);
  });

  it('timer: starts, replaces a running timer with the same id, and clears its elapsed flag', () => {
    const h = playing();
    h.state = { ...h.state, vars: { 'elapsed:work': true } };
    h.run([{ timer: { id: 'work', kind: 'interval', seconds: 20, label: 'Work' } }, { timer: { id: 'work', kind: 'interval', seconds: 30 } }]);
    expect(h.state.timers).toEqual([{ id: 'work', kind: 'interval', durationSec: 30, phase: 'work' }]);
    expect(h.state.vars).toEqual({});
  });

  it('turn next: advances seat order and increments the round on wrap', () => {
    const h = playing({ players: ['p1', 'p2'] });
    const step = h.run([{ turn: 'next' }, { turn: 'next' }]);
    expect(step.events).toEqual([
      { type: 'TurnStarted', playerId: 'p2', round: 0 },
      { type: 'TurnStarted', playerId: 'p1', round: 1 },
    ]);
  });

  it('if/then/else: runs one branch', () => {
    const h = playing();
    const step = h.run([{ if: 'table.empty', then: [{ flip: {} }], else: [{ deal: { to: 'hand', count: 1 } }] }]);
    expect(types(step.events)).toEqual(['CardFlipped']);
    expect(types(h.run([{ if: 'table.empty', then: [{ flip: {} }] }]).events)).toEqual([]);
  });

  it('repeat: runs steps n times, count may come from a setting', () => {
    const def = game({ settingsSchema: { rows: { type: 'number', min: 1, max: 5, default: 3 } } });
    const h = harness(def);
    h.state = { ...h.state, phase: 'playing' };
    expect(types(h.run([{ repeat: { setting: 'rows' }, steps: [{ flip: {} }] }]).events)).toEqual(['CardFlipped', 'CardFlipped', 'CardFlipped']);
  });
});

// ── Conditions ──────────────────────────────────────────────────────────────

describe('conditions', () => {
  const byId = new Map(CARDS.map((x) => [x.id, x]));
  const cards = (...ids: string[]) => ids.map((id) => byId.get(id)!);

  it.each<[string, string[], 'suit' | 'rank' | 'color' | 'adjacent-rank', boolean]>([
    ['same suit', ['h2', 'hK'], 'suit', true],
    ['different suit', ['h2', 's4'], 'suit', false],
    ['one card never matches', ['h2'], 'suit', false],
    ['same rank', ['h2', 'h2'], 'rank', true],
    ['red with red', ['h3', 'd5'], 'color', true],
    ['red with black', ['h3', 'c6'], 'color', false],
    ['joker is its own color', ['jJOKER', 's4'], 'color', false],
    ['adjacent ranks', ['h2', 'h3'], 'adjacent-rank', true],
    ['A wraps to K', ['sA', 'hK'], 'adjacent-rank', true],
    ['A wraps to 2', ['sA', 'h2'], 'adjacent-rank', true],
    ['gap', ['h2', 's4'], 'adjacent-rank', false],
    ['jokers are never adjacent', ['jJOKER', 'h2'], 'adjacent-rank', false],
  ])('match %s', (_label, ids, on, expected) => {
    expect(cardsMatch(cards(...ids), on)).toBe(expected);
  });

  describe('against state', () => {
    const h = harness(game({ settingsSchema: { matchOn: { type: 'enum', options: ['suit', 'color'], default: 'color' } } }));
    const ctx: EngineContext = h.ctx;
    const state = (table: string[], extra: Partial<GameState> = {}): GameState => ({
      ...h.state, phase: 'playing', zones: { ...h.state.zones, table, draw: [] }, ...extra,
    });
    const ev = (cond: Condition, s: GameState) => evaluate(cond, s, ctx);

    it('selectors pick first/last/middle/all', () => {
      const s = state(['h2', 'h3', 's4', 'd5']);
      expect(select(s, 'table.first')).toEqual(['h2']);
      expect(select(s, 'table.last')).toEqual(['d5']);
      expect(select(s, 'table.middle')).toEqual(['h3', 's4']);
      expect(select(state(['h2']), 'table.middle')).toEqual([]);
    });

    it('zone.empty and count comparisons', () => {
      expect(ev('draw.empty', state(['h2']))).toBe(true);
      expect(ev('table.empty', state(['h2']))).toBe(false);
      expect(ev({ count: 'table', lt: 2 }, state(['h2']))).toBe(true);
      expect(ev({ count: 'table', gte: 2 }, state(['h2']))).toBe(false);
      expect(ev({ count: 'table', eq: 1 }, state(['h2']))).toBe(true);
    });

    it('match reads its mode from a setting', () => {
      expect(ev({ match: ['table.first', 'table.last'], on: { setting: 'matchOn' } }, state(['h2', 's4', 'd5']))).toBe(true); // both red
    });

    it('compare high/low by rank (A high); jokers make it false', () => {
      expect(ev({ compare: ['table.first', 'table.last'], wins: 'high' }, state(['sA', 'hK']))).toBe(true);
      expect(ev({ compare: ['table.first', 'table.last'], wins: 'low' }, state(['sA', 'hK']))).toBe(false);
      expect(ev({ compare: ['table.first', 'table.last'], wins: 'low' }, state(['jJOKER', 'h2']))).toBe(false);
      expect(ev({ compare: ['table.first', 'table.last'], wins: 'high' }, state(['h2']))).toBe(false); // same card
    });

    it('elapsed, setting equals, all/any/not', () => {
      const s = state([], { vars: { 'elapsed:cap': true } });
      expect(ev({ elapsed: 'cap' }, s)).toBe(true);
      expect(ev({ elapsed: 'other' }, s)).toBe(false);
      expect(ev({ setting: 'matchOn', equals: 'color' }, s)).toBe(true);
      expect(ev({ all: ['table.empty', { elapsed: 'cap' }] }, s)).toBe(true);
      expect(ev({ any: [{ not: 'table.empty' }, { elapsed: 'other' }] }, s)).toBe(false);
    });
  });
});

describe('counters (incr / var)', () => {
  it('incr counts from 0, by 1 or a reference; var feeds numbers and conditions', () => {
    const def = game({ settingsSchema: { rows: { type: 'number', min: 1, max: 9, default: 3 } } });
    const h = harness(def);
    h.state = { ...h.state, phase: 'playing' };
    expect(evaluate({ var: 'row', eq: 0 }, h.state, h.ctx)).toBe(true);
    h.run([{ incr: 'row' }, { incr: 'row', by: { setting: 'rows' } }]);
    expect(h.state.vars).toEqual({ 'var:row': 4 });
    expect(evaluate({ var: 'row', gte: { setting: 'rows' } }, h.state, h.ctx)).toBe(true);
    expect(evaluate({ var: 'row', lt: 4 }, h.state, h.ctx)).toBe(false);
    h.run([{ incr: 'n', by: 2 }]);
    expect(types(h.run([{ deal: { to: 'table', count: { var: 'n' } } }]).events)).toEqual(['CardsDealt']);
    expect(h.state.zones.table).toHaveLength(2);
    expect(types(h.run([{ repeat: { var: 'n' }, steps: [{ flip: {} }] }]).events)).toEqual(['CardFlipped', 'CardFlipped']);
  });

  it('rejects a var condition without exactly one comparison', () => {
    expect(GameDefinitionSchema.safeParse({ ...game(), end: { when: { var: 'row' } } }).success).toBe(false);
  });
});

describe('assign (object form)', () => {
  it('to: each gives every player the same cards, in seat order with sequential ids', () => {
    const h = harness(game(), { players: ['p1', 'p2', 'p3'] });
    withZones(h, { table: ['h2'] });
    const step = h.run([{ assign: { cards: 'table.all', to: 'each' } }]);
    expect(step.events.map((e) => e.type === 'TaskAssigned' && [e.task.id, e.task.playerId])).toEqual([['t1', 'p1'], ['t2', 'p2'], ['t3', 'p3']]);
  });

  it('timedSec sets timed tasks to the window (unmultiplied), leaving reps and rest alone', () => {
    const h = harness(game(), { settings: { repMultiplier: 2, jokerRule: 'rest' } });
    withZones(h, { table: ['h3', 'sA', 'jJOKER'] });
    const step = h.run([{ assign: { cards: 'table.all', timedSec: 20 } }]);
    const tasks = step.events.flatMap((e) => (e.type === 'TaskAssigned' ? [[e.task.kind, e.task.measure, e.task.amount]] : []));
    expect(tasks).toEqual([['exercise', 'reps', 6], ['exercise', 'seconds', 20], ['rest', 'seconds', 30]]);
  });
});

describe('interval timers', () => {
  const def = game({
    setup: { shuffle: false, deal: [{ timer: { id: 'round', kind: 'interval', seconds: 20, restSeconds: 10, label: 'Work' } }] },
    end: { when: { elapsed: 'round' } },
  });

  it('work elapsing starts rest on the same timer; only rest elapsing counts as elapsed', () => {
    const h = harness(def);
    const dealt = h.dispatch({ type: 'deal', playerId: 'p1' });
    expect(dealt.events[1]).toEqual({ type: 'TimerStarted', timer: { id: 'round', kind: 'interval', durationSec: 20, restSec: 10, phase: 'work', label: 'Work' } });
    const work = h.dispatch({ type: 'timerElapsed', playerId: 'p1', timerId: 'round' });
    expect(work.events).toEqual([
      { type: 'TimerElapsed', timerId: 'round', phase: 'work' },
      { type: 'TimerStarted', timer: { id: 'round', kind: 'interval', durationSec: 10, restSec: 10, phase: 'rest', label: 'Work' } },
    ]);
    expect(h.state.phase).toBe('playing');
    const rest = h.dispatch({ type: 'timerElapsed', playerId: 'p1', timerId: 'round' });
    expect(types(rest.events)).toEqual(['TimerElapsed', 'GameOver']);
    expect(rest.events[0]).toMatchObject({ phase: 'rest' });
    expect(h.state.timers).toEqual([]);
  });

  it('an interval without restSeconds ends after work; restSeconds on a countdown is invalid', () => {
    const noRest = game({ setup: { shuffle: false, deal: [{ timer: { id: 'r', kind: 'interval', seconds: 20 } }] }, end: { when: { elapsed: 'r' } } });
    const h = harness(noRest);
    h.dispatch({ type: 'deal', playerId: 'p1' });
    expect(types(h.dispatch({ type: 'timerElapsed', playerId: 'p1', timerId: 'r' }).events)).toEqual(['TimerElapsed', 'GameOver']);
    const bad = { ...game(), setup: { shuffle: false, deal: [{ timer: { id: 'c', kind: 'countdown', seconds: 5, restSeconds: 5 } }] } };
    expect(GameDefinitionSchema.safeParse(bad).success).toBe(false);
  });
});

// ── Group-game primitives ───────────────────────────────────────────────────

describe('player zones and selectors', () => {
  it('hands/piles select each player’s zone in seat order; hand/pile mean the actor', () => {
    const h = harness(game(), { players: ['p1', 'p2', 'p3'] });
    withZones(h, { hands: { p1: ['h2', 'h3'], p2: [], p3: ['s4'] }, piles: { p1: ['d5'], p2: ['c6'], p3: ['hK'] } });
    expect(select(h.state, 'piles.last')).toEqual(['d5', 'c6', 'hK']);
    expect(select(h.state, 'hands.all')).toEqual(['h2', 'h3', 's4']);
    expect(select(h.state, 'hand.all', { ctx: h.ctx, actor: 'p3' })).toEqual(['s4']);
    expect(evaluate({ anyEmpty: 'hands' }, h.state, h.ctx)).toBe(true);
    expect(evaluate({ anyEmpty: 'piles' }, h.state, h.ctx)).toBe(false);
  });

  it('deal to piles: one card per player per pass, face up', () => {
    const h = harness(game(), { players: ['p1', 'p2'] });
    h.state = { ...h.state, phase: 'playing' };
    const step = h.run([{ deal: { to: 'piles', count: 1 } }]);
    expect(step.events).toEqual([
      { type: 'CardsDealt', zone: 'pile:p1', cardIds: ['h2'], faceUp: true },
      { type: 'CardsDealt', zone: 'pile:p2', cardIds: ['h3'], faceUp: true },
    ]);
  });

  it('$players is the player count; reset clears a counter', () => {
    const h = harness(game(), { players: ['p1', 'p2', 'p3'] });
    h.run([{ incr: 'passes', by: 3 }]);
    expect(evaluate({ var: 'passes', gte: { var: '$players' } }, h.state, h.ctx)).toBe(true);
    h.run([{ reset: 'passes' }]);
    expect(evaluate({ var: 'passes', eq: 0 }, h.state, h.ctx)).toBe(true);
  });
});

describe('winners and assign targets', () => {
  // Distinct cards of equal rank (card ids are unique; selecting one id twice yields it once).
  const DUEL_CARDS = [...CARDS, c('clubs', 'K'), c('clubs', '2'), c('spades', '2')];
  const duel = (piles: Record<string, string[]>) => {
    const h = harness(game(), { players: ['p1', 'p2', 'p3'], cards: DUEL_CARDS });
    withZones(h, { piles });
    return h;
  };

  it('highest card wins; losers get every selected card; winners none', () => {
    const h = duel({ p1: ['h2'], p2: ['hK'], p3: ['s4'] });
    const step = h.run([{ winners: { cards: 'piles.last', wins: 'high' } }, { assign: { cards: 'piles.last', to: 'losers' } }]);
    expect(step.events.filter((e) => e.type === 'RoundWon')).toEqual([{ type: 'RoundWon', playerId: 'p2', round: 0 }]);
    const owners = step.events.flatMap((e) => (e.type === 'TaskAssigned' ? [`${e.task.playerId}:${e.task.cardIds.join('+')}`] : []));
    expect(owners).toEqual(['p1:h2+hK', 'p1:s4', 'p3:h2+hK', 'p3:s4']);
  });

  it('ties at the top all win; if everyone ties, nobody wins; jokers never win; low mode', () => {
    expect(winnersAfter(duel({ p1: ['hK'], p2: ['h2'], p3: ['cK'] }), 'high')).toEqual(['p1', 'p3']);
    expect(winnersAfter(duel({ p1: ['h2'], p2: ['c2'], p3: ['s2'] }), 'high')).toEqual([]);
    expect(winnersAfter(duel({ p1: ['jJOKER'], p2: ['h3'], p3: ['h2'] }), 'high')).toEqual(['p2']);
    expect(winnersAfter(duel({ p1: ['hK'], p2: ['h3'], p3: ['h2'] }), 'low')).toEqual(['p3']);
  });

  function winnersAfter(h: ReturnType<typeof harness>, wins: 'high' | 'low') {
    return h.run([{ winners: { cards: 'piles.last', wins } }]).events.flatMap((e) => (e.type === 'RoundWon' ? [e.playerId] : []));
  }

  it('assign to owner: each card goes to the player whose hand it was in', () => {
    const h = harness(game(), { players: ['p1', 'p2'] });
    withZones(h, { hands: { p1: ['h2'], p2: ['s4', 'hK'] } });
    const step = h.run([{ assign: { cards: 'hands.all', to: 'owner' } }]);
    expect(step.events.flatMap((e) => (e.type === 'TaskAssigned' ? [`${e.task.playerId}:${e.task.cardIds.join('+')}`] : []))).toEqual(['p1:h2', 'p2:s4', 'p2:hK']);
  });
});

describe('draw filter (only)', () => {
  it('redraws cards whose exercise has the other measure (and jokers) to discard', () => {
    const cards = [c('spades', '4', 'plank'), c('joker', 'JOKER'), c('hearts', '2'), c('spades', 'A', 'plank'), c('hearts', '3')];
    const h = harness(game(), { cards });
    h.state = { ...h.state, phase: 'playing' };
    const step = h.run([{ deal: { to: 'table', count: 2, only: { measure: 'reps' } } }]);
    expect(step.events).toEqual([
      { type: 'CardsMoved', from: 'draw', to: 'discard', cardIds: ['s4'] },
      { type: 'CardsMoved', from: 'draw', to: 'discard', cardIds: ['jJOKER'] },
      { type: 'CardsMoved', from: 'draw', to: 'discard', cardIds: ['sA'] },
      { type: 'CardsDealt', zone: 'table', cardIds: ['h2', 'h3'], faceUp: true },
    ]);
    expect(h.state.zones.table).toEqual(['h2', 'h3']);
    expect(h.state.zones.discard).toEqual(['s4', 'jJOKER', 'sA']);
    expect(types(h.run([{ flip: { only: { measure: 'reps' } } }]).events)).toEqual([]);
  });
});

describe('simultaneous turns', () => {
  const def = () => game({
    turn: {
      mode: 'simultaneous',
      each: [{ deal: { to: 'pile', count: 1 } }],
      then: [{ incr: 'round' }, { winners: { cards: 'piles.last', wins: 'high' } }],
    },
    end: { when: { var: 'round', gte: 2 } },
    scoring: 'rounds-won',
  });

  it('each player flips once; `then` runs when all have acted; rounds-won scoring', () => {
    const h = harness(def(), { players: ['p1', 'p2'], cards: [c('hearts', '2'), c('hearts', 'K'), c('hearts', 'A'), c('hearts', '3')] });
    h.dispatch({ type: 'deal', playerId: 'p1' });
    expect(types(h.dispatch({ type: 'flip', playerId: 'p2' }).events)).toEqual(['CardsDealt']);
    expect(h.dispatch({ type: 'flip', playerId: 'p2' }).events[0]).toMatchObject({ reason: 'already-acted' });
    expect(types(h.dispatch({ type: 'flip', playerId: 'p1' }).events)).toEqual(['CardsDealt', 'RoundWon']);
    // Round 2: acted flags were cleared.
    h.dispatch({ type: 'flip', playerId: 'p1' });
    const last = h.dispatch({ type: 'flip', playerId: 'p2' });
    // Unshuffled draw h2 hK hA h3: round 1 p2=h2, p1=hK; round 2 p1=hA, p2=h3 → p1 wins both.
    expect(last.events.at(-1)).toEqual({ type: 'GameOver', reason: 'end', scores: { p1: 2, p2: 0 } });
  });
});

describe('actions (play / pass)', () => {
  const rush = () => game({
    turn: undefined,
    actions: {
      play: {
        require: [{ when: { match: ['intent.card', 'table.last'], on: 'suit' }, reason: 'no-match' }],
        steps: [{ move: 'intent.card', to: 'table' }, { reset: 'passes' }],
      },
      pass: { steps: [{ deal: { to: 'hand', count: 1 } }, { incr: 'passes' }] },
    },
    end: { when: { anyEmpty: 'hands' }, then: [{ assign: { cards: 'hands.all', to: 'owner' } }] },
  });

  /** Mid-game table (set directly: dealing with empty hands would end the game at once). */
  function table() {
    const h = harness(rush(), { players: ['p1', 'p2'] });
    h.state = { ...h.state, phase: 'playing', zones: { ...h.state.zones, table: ['h2'], hands: { p1: ['h3'], p2: ['s4', 'hK'] }, draw: ['d5'] } };
    return h;
  }

  it('any player may play a matching card from their own hand', () => {
    const h = table();
    expect(h.dispatch({ type: 'play', playerId: 'p2', cardId: 'hK' }).events).toEqual([
      { type: 'CardsMoved', from: 'hand:p2', to: 'table', cardIds: ['hK'] },
    ]);
  });

  it.each<[string, Intent, string]>([
    ['a card not in the sender’s hand', { type: 'play', playerId: 'p1', cardId: 'hK' }, 'not-in-hand'],
    ['an unknown card', { type: 'play', playerId: 'p1', cardId: 'nope' }, 'not-in-hand'],
    ['a card failing the require check', { type: 'play', playerId: 'p2', cardId: 's4' }, 'no-match'],
    ['flip in a game without turns', { type: 'flip', playerId: 'p1' }, 'not-supported'],
  ])('rejects %s', (_label, intent, reason) => {
    expect(table().dispatch(intent).events[0]).toMatchObject({ type: 'IntentRejected', reason });
  });

  it('pass draws a card; emptying a hand ends the game after leftovers are worked (end.then)', () => {
    const h = table();
    expect(types(h.dispatch({ type: 'pass', playerId: 'p2' }).events)).toEqual(['CardsDealt']);
    const end = h.dispatch({ type: 'play', playerId: 'p1', cardId: 'h3' });
    // p2 holds s4 (plank), hK and d5 (squat): leftovers group into one task per exercise.
    expect(types(end.events)).toEqual(['CardsMoved', 'TaskAssigned', 'TaskAssigned']);
    expect(h.state.phase).toBe('playing');
    expect(h.dispatch({ type: 'play', playerId: 'p2', cardId: 'hK' }).events[0]).toMatchObject({ reason: 'game-ending' });
    for (const t of h.state.tasks.filter((x) => x.playerId === 'p2')) h.dispatch({ type: 'completeTask', playerId: 'p2', taskId: t.id });
    expect(h.state.phase).toBe('finished');
  });
});

describe('race', () => {
  const raceGame = () => game({
    race: true,
    turn: { steps: [{ incr: 'round' }, { deal: { to: 'table', count: 2 } }, { assign: { cards: 'table.all', to: 'each' } }] },
    end: { when: { var: 'round', gte: 1 } },
    scoring: 'rounds-won',
  });

  function round() {
    const h = harness(raceGame(), { players: ['p1', 'p2'], cards: [c('hearts', '2'), c('spades', '4', 'plank'), c('hearts', '3')] });
    h.dispatch({ type: 'deal', playerId: 'p1' });
    h.dispatch({ type: 'flip', playerId: 'p1' });
    const tasks = (p: string) => h.state.tasks.filter((t) => t.playerId === p);
    return { h, tasks };
  }

  it('the first player to finish all of the round’s tasks wins it; later finishers don’t', () => {
    const { h, tasks } = round();
    const [p2a, p2b] = tasks('p2');
    const [p1a, p1b] = tasks('p1');
    h.dispatch({ type: 'completeTask', playerId: 'p1', taskId: p1a.id });
    h.dispatch({ type: 'completeTask', playerId: 'p2', taskId: p2a.id });
    expect(types(h.dispatch({ type: 'completeTask', playerId: 'p2', taskId: p2b.id }).events)).toEqual(['TaskCompleted', 'RoundWon']);
    const last = h.dispatch({ type: 'completeTask', playerId: 'p1', taskId: p1b.id });
    expect(types(last.events)).toEqual(['TaskCompleted', 'GameOver']);
    expect(h.state.scores).toEqual({ p1: 0, p2: 1 });
  });

  it('skipping a task means you cannot win that round', () => {
    const { h, tasks } = round();
    const [p1a, p1b] = tasks('p1');
    h.dispatch({ type: 'skipTask', playerId: 'p1', taskId: p1a.id });
    expect(types(h.dispatch({ type: 'completeTask', playerId: 'p1', taskId: p1b.id }).events)).toEqual(['TaskCompleted']);
  });
});

// ── Hidden-game primitives ──────────────────────────────────────────────────

describe('betting', () => {
  const poker = () => game({
    hidden: true,
    turn: { steps: [{ deal: { to: 'hands', count: 1 } }, { startBetting: true }] },
    betting: { maxBet: 10, then: [{ reveal: 'hands.all' }, { winners: { cards: 'hands.all', by: 'poker' } }, { assignPot: { to: 'losers' } }] },
    end: { when: { var: 'never', gte: 1 } },
    scoring: 'rounds-won',
  });

  function table(players = ['p1', 'p2', 'p3']) {
    // Unshuffled draw: p1 h2, p2 h3, p3 s4 (plank). Highest card wins a 1-card showdown.
    const h = harness(poker(), { players });
    h.dispatch({ type: 'deal', playerId: 'p1' });
    h.dispatch({ type: 'flip', playerId: 'p1' });
    return h;
  }

  it('bet raises the stake and reopens action; call matches; pass folds when behind', () => {
    const h = table();
    expect(h.dispatch({ type: 'bet', playerId: 'p1', amount: 4 }).events).toEqual([{ type: 'BetPlaced', playerId: 'p1', amount: 4, pot: 4 }]);
    expect(h.dispatch({ type: 'call', playerId: 'p2' }).events).toEqual([{ type: 'BetPlaced', playerId: 'p2', amount: 4, pot: 8 }]);
    expect(h.dispatch({ type: 'pass', playerId: 'p3' }).events.map((e) => e.type)).toEqual([
      'PlayerFolded', 'CardsRevealed', 'RoundWon', 'TaskAssigned', 'TaskAssigned',
    ]);
    // p2's 3 beats p1's 2; p3 folded (hand not revealed) but still works the pot.
    const revealed = h.log.find((e) => (e as { type: string }).type === 'CardsRevealed') as { cardIds: string[] };
    expect(revealed.cardIds.sort()).toEqual(['h2', 'h3']);
    const pot = h.state.tasks.map((t) => [t.playerId, t.amount, t.measure]);
    expect(pot).toEqual([['p1', 8, 'reps'], ['p3', 40, 'seconds']]); // plank: 8 reps of pot = 40 s
    expect(h.state.vars['bet:active']).toBeUndefined();
  });

  it('checks around close the round with an empty pot (no tasks)', () => {
    const h = table(['p1', 'p2']);
    h.dispatch({ type: 'pass', playerId: 'p1' });
    const closing = h.dispatch({ type: 'pass', playerId: 'p2' });
    expect(closing.events.map((e) => e.type)).toEqual(['PlayerChecked', 'CardsRevealed', 'RoundWon']);
    expect(h.state.tasks).toEqual([]);
  });

  it('a raise after checks reopens action for everyone', () => {
    const h = table(['p1', 'p2']);
    h.dispatch({ type: 'pass', playerId: 'p1' });
    h.dispatch({ type: 'bet', playerId: 'p2', amount: 2 });
    expect(evaluate({ flag: 'betting' }, h.state, h.ctx)).toBe(true);
    expect(h.dispatch({ type: 'call', playerId: 'p1' }).events.at(-1)).toMatchObject({ type: 'TaskAssigned' });
  });

  it.each<[string, Intent, string]>([
    ['betting out of turn', { type: 'bet', playerId: 'p2', amount: 2 }, 'not-your-turn'],
    ['a bet above the maximum', { type: 'bet', playerId: 'p1', amount: 11 }, 'bad-bet'],
    ['a call with nothing to call', { type: 'call', playerId: 'p1' }, 'nothing-to-call'],
    ['flipping during a betting round', { type: 'flip', playerId: 'p1' }, 'betting-open'],
  ])('rejects %s', (_label, intent, reason) => {
    expect(table().dispatch(intent).events[0]).toMatchObject({ type: 'IntentRejected', reason });
  });

  it('a bet that doesn’t raise is rejected', () => {
    const h = table();
    h.dispatch({ type: 'bet', playerId: 'p1', amount: 4 });
    expect(h.dispatch({ type: 'bet', playerId: 'p2', amount: 4 }).events[0]).toMatchObject({ reason: 'bad-bet' });
  });
});

describe('bluff claims and challenges', () => {
  const bluff = () => game({ hidden: true, turn: undefined, bluff: { maxCards: 2 }, end: { when: { flag: 'bluff:winner' } }, scoring: 'rounds-won' });
  // Required rank starts at A. Cards: sA (true ace), h2, hK, jJOKER (wild).
  function table(hands: Record<string, string[]>) {
    const h = harness(bluff(), { players: ['p1', 'p2', 'p3'] });
    h.state = { ...h.state, phase: 'playing', zones: { ...h.state.zones, hands: { p1: [], p2: [], p3: [], ...hands }, draw: [] } };
    return h;
  }

  it('a claim moves cards face down, names the required rank, keeps the cards secret, and passes the turn', () => {
    const h = table({ p1: ['sA', 'h2'], p2: ['h3'], p3: ['s4'] });
    const step = h.dispatch({ type: 'claim', playerId: 'p1', cardIds: ['h2'] });
    expect(step.events).toEqual([
      { type: 'CardsMoved', from: 'hand:p1', to: 'table', cardIds: ['h2'] },
      { type: 'ClaimMade', playerId: 'p1', rank: 'A', count: 1 },
    ]);
    expect(h.state.faceUp).toEqual([]);
    expect(h.state.vars['secret:claim:cards']).toBe('h2');
    expect(h.state.turn.index).toBe(1);
  });

  it('a caught liar works and takes the pile', () => {
    const h = table({ p1: ['sA', 'h2'], p2: ['h3'], p3: ['s4'] });
    h.dispatch({ type: 'claim', playerId: 'p1', cardIds: ['h2'] });
    const step = h.dispatch({ type: 'call', playerId: 'p3' });
    expect(step.events.slice(0, 2)).toEqual([
      { type: 'CardsRevealed', cardIds: ['h2'] },
      { type: 'ClaimChallenged', playerId: 'p3', claimant: 'p1', lied: true, loser: 'p1' },
    ]);
    expect(h.state.tasks.map((t) => [t.playerId, t.cardIds])).toEqual([['p1', ['h2']]]);
    expect(h.state.zones.hands['p1'].sort()).toEqual(['h2', 'sA']);
    expect(h.state.zones.table).toEqual([]);
  });

  it('a wrong challenger works the pile; a truthful claimant with an empty hand wins', () => {
    const h = table({ p1: ['jJOKER'], p2: ['h3'], p3: ['s4'] });
    h.dispatch({ type: 'claim', playerId: 'p1', cardIds: ['jJOKER'] }); // joker is wild
    const step = h.dispatch({ type: 'call', playerId: 'p2' });
    expect(step.events[1]).toEqual({ type: 'ClaimChallenged', playerId: 'p2', claimant: 'p1', lied: false, loser: 'p2' });
    expect(step.events.map((e) => e.type)).toContain('RoundWon');
    // The loser still works the pile (a joker under jokerRule rest) before the game ends.
    const [rest] = h.state.tasks;
    expect(rest).toMatchObject({ playerId: 'p2', kind: 'rest' });
    h.dispatch({ type: 'completeTask', playerId: 'p2', taskId: rest.id });
    expect(h.state.phase).toBe('finished');
    expect(h.state.scores).toEqual({ p1: 1, p2: 0, p3: 0 });
  });

  it('the next claim accepts the previous one; an emptied claimant then wins', () => {
    const h = table({ p1: ['h2'], p2: ['h3'], p3: ['s4'] });
    h.dispatch({ type: 'claim', playerId: 'p1', cardIds: ['h2'] });
    const next = h.dispatch({ type: 'claim', playerId: 'p2', cardIds: ['h3'] });
    expect(next.events.map((e) => e.type)).toEqual(['RoundWon', 'GameOver']);
  });

  it.each<[string, Intent, string]>([
    ['a claim out of turn', { type: 'claim', playerId: 'p2', cardIds: ['h3'] }, 'not-your-turn'],
    ['claiming someone else’s card', { type: 'claim', playerId: 'p1', cardIds: ['h3'] }, 'not-in-hand'],
    ['too many cards', { type: 'claim', playerId: 'p1', cardIds: ['sA', 'h2', 'hK'] }, 'bad-claim'],
    ['a call with no open claim', { type: 'call', playerId: 'p2' }, 'no-claim'],
  ])('rejects %s', (_label, intent, reason) => {
    const h = table({ p1: ['sA', 'h2', 'hK'], p2: ['h3'], p3: ['s4'] });
    expect(h.dispatch(intent).events[0]).toMatchObject({ type: 'IntentRejected', reason });
  });

  it('you cannot call your own claim', () => {
    const h = table({ p1: ['sA', 'h2'], p2: ['h3'], p3: ['s4'] });
    h.dispatch({ type: 'claim', playerId: 'p1', cardIds: ['sA'] });
    expect(h.dispatch({ type: 'call', playerId: 'p1' }).events[0]).toMatchObject({ reason: 'own-claim' });
  });
});

describe('teams', () => {
  const relay = () => game({
    hidden: true,
    teams: { size: 2 },
    setup: { shuffle: false, deal: [{ deal: { to: 'teams', count: 2 } }] },
    turn: { steps: [{ move: 'team.first', to: 'table', faceUp: true }, { assign: 'table.last' }, { turn: 'next' }] },
    end: { when: { anyEmpty: 'teams' }, then: [{ winners: { by: 'empty-team' } }] },
    scoring: 'rounds-won',
  });

  it('interleaves teams by seat, deals to captains, and lets teammates work the shared hand in turn', () => {
    const h = harness(relay(), { players: ['a1', 'b1', 'a2', 'b2'] });
    h.dispatch({ type: 'deal', playerId: 'a1' });
    expect(h.state.zones.hands).toEqual({ a1: ['h2', 's4'], b1: ['h3', 'd5'], a2: [], b2: [] });
    const workers: string[] = [];
    for (const p of ['a1', 'b1', 'a2']) {
      h.dispatch({ type: 'flip', playerId: p });
      const t = h.state.tasks.at(-1)!;
      workers.push(`${t.playerId}:${t.cardIds[0]}`);
      h.dispatch({ type: 'completeTask', playerId: p, taskId: t.id });
    }
    expect(workers).toEqual(['a1:h2', 'b1:h3', 'a2:s4']); // a2 played team A's second card
    expect(h.log.filter((e) => (e as { type: string }).type === 'RoundWon')).toEqual([
      { type: 'RoundWon', playerId: 'a1', round: 0 }, { type: 'RoundWon', playerId: 'a2', round: 0 },
    ]);
    expect(h.state.phase).toBe('finished');
  });
});

describe('reveal and reshuffle', () => {
  it('reshuffle returns discard to the draw pile with the RNG; reveal turns cards face up once', () => {
    const h = harness(game(), { players: ['p1'] });
    withZones(h, { draw: ['h2'], discard: ['h3', 's4', 'd5'], table: ['hK'] });
    const step = h.run([{ reshuffle: true }, { reveal: 'table.all' }, { reveal: 'table.all' }]);
    expect(step.events).toEqual([{ type: 'CardsShuffled', zone: 'draw', count: 4 }, { type: 'CardsRevealed', cardIds: ['hK'] }]);
    expect([...h.state.zones.draw].sort()).toEqual(['d5', 'h2', 'h3', 's4']);
    expect(h.state.zones.discard).toEqual([]);
    expect(h.state.rngState).not.toBe(1);
  });
});

describe('a player leaving mid-game', () => {
  const simultaneous = () => game({
    turn: {
      mode: 'simultaneous',
      each: [{ deal: { to: 'pile', count: 1 } }],
      then: [{ incr: 'round' }, { winners: { cards: 'piles.last', wins: 'high' } }],
    },
    end: { when: { var: 'round', gte: 2 } },
    scoring: 'rounds-won',
  });

  it('closes a round the remaining players already finished, and discards the leaver’s cards', () => {
    const h = harness(simultaneous(), { players: ['p1', 'p2', 'p3'] });
    h.dispatch({ type: 'deal', playerId: 'p1' });
    h.dispatch({ type: 'flip', playerId: 'p1' });
    h.dispatch({ type: 'flip', playerId: 'p3' });
    expect(counter(h.state, 'round')).toBe(0); // still waiting for p2

    const step = h.dispatch({ type: 'leave', playerId: 'p2' });
    expect(step.events[0]).toEqual({ type: 'PlayerLeft', playerId: 'p2' });
    expect(types(step.events)).toContain('RoundWon');
    expect(counter(h.state, 'round')).toBe(1); // the round finished without them
    expect(h.state.turn.order).toEqual(['p1', 'p3']);
    expect(h.state.players.find((p) => p.id === 'p2')).toEqual({ id: 'p2', seat: 1, left: true });
    expect(h.state.zones.piles['p2']).toEqual([]);

    // The next round only waits for the two who are still here.
    h.dispatch({ type: 'flip', playerId: 'p1' });
    expect(counter(h.state, 'round')).toBe(1);
    h.dispatch({ type: 'flip', playerId: 'p3' });
    expect(h.state.phase).toBe('finished');
    expect(h.dispatch({ type: 'flip', playerId: 'p2' }).events[0]).toMatchObject({ reason: 'game-over' });
  });

  it('skips the leaver’s pending tasks so play isn’t blocked, and discards their hand', () => {
    const def = game({
      setup: { shuffle: false, deal: [{ deal: { to: 'hands', count: 2 } }] },
      turn: { steps: [{ flip: {} }, { assign: { cards: 'table.last', to: 'each' } }, { turn: 'next' }] },
      end: { when: 'draw.empty' },
    });
    const h = harness(def, { players: ['p1', 'p2'] });
    h.dispatch({ type: 'deal', playerId: 'p1' });
    h.dispatch({ type: 'flip', playerId: 'p1' });
    expect(h.state.tasks.filter((t) => t.status === 'pending')).toHaveLength(2);
    expect(h.dispatch({ type: 'flip', playerId: 'p2' }).events[0]).toMatchObject({ reason: 'tasks-pending' });

    const hand = [...h.state.zones.hands['p2']];
    const step = h.dispatch({ type: 'leave', playerId: 'p2' });
    expect(step.events).toContainEqual({ type: 'CardsMoved', from: 'hand:p2', to: 'discard', cardIds: hand });
    expect(h.state.tasks.filter((t) => t.playerId === 'p2' && t.status === 'skipped')).toHaveLength(1);

    const mine = h.state.tasks.find((t) => t.playerId === 'p1' && t.status === 'pending')!;
    h.dispatch({ type: 'completeTask', playerId: 'p1', taskId: mine.id });
    expect(types(h.dispatch({ type: 'flip', playerId: 'p1' }).events)).toContain('CardFlipped'); // p1 plays on alone
  });

  it('moves the turn on when the current player leaves, and rejects leaving twice', () => {
    const def = game({ turn: { steps: [{ flip: {} }, { turn: 'next' }] }, end: { when: 'draw.empty' } });
    const h = harness(def, { players: ['p1', 'p2', 'p3'] });
    h.dispatch({ type: 'deal', playerId: 'p1' });
    h.dispatch({ type: 'flip', playerId: 'p1' }); // turn moves to p2
    expect(currentPlayer(h.state)).toBe('p2');
    h.dispatch({ type: 'leave', playerId: 'p2' });
    expect(currentPlayer(h.state)).toBe('p3');
    expect(h.dispatch({ type: 'leave', playerId: 'p2' }).events[0]).toMatchObject({ type: 'IntentRejected', reason: 'not-playing' });
    expect(h.dispatch({ type: 'leave', playerId: 'nobody' }).events[0]).toMatchObject({ reason: 'unknown-player' });
  });
});
