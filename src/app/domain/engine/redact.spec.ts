import type { Card } from '../models/schemas';
import { createInitialState } from './reducer';
import { HIDDEN_CARD, HIDDEN_EXERCISE, redactEvents, redactState, visibleCardIds } from './redact';
import type { GameState, Task } from './state';

const CARDS: Card[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => ({ id, suit: 'hearts', rank: '2', exerciseId: 'squat', baseAmount: 2 }));

function table(over: Partial<GameState['zones']> = {}, extra: Partial<GameState> = {}): GameState {
  const s = createInitialState({ players: ['p1', 'p2', 'p3', 'p4'], seed: 9, deck: { cards: CARDS } });
  return {
    ...s, phase: 'playing', rngState: 1234,
    zones: { draw: ['g', 'h'], discard: [], table: [], hands: { p1: ['a', 'b'], p2: ['c'], p3: [], p4: [] }, piles: {}, ...over },
    ...extra,
  };
}

const task = (over: Partial<Task>): Task => ({
  id: 't1', playerId: 'p2', cardIds: ['c'], kind: 'exercise', exerciseId: 'squat', amount: 5, measure: 'reps', status: 'pending', ...over,
});

describe('redactState', () => {
  it('hides other hands, the draw pile and face-down cards but keeps zone sizes; shows face-up cards', () => {
    const view = redactState(table({ table: ['d', 'e'] }, { faceUp: ['e'] }), 'p1');
    expect(view.zones).toEqual({
      draw: [HIDDEN_CARD, HIDDEN_CARD], discard: [], table: [HIDDEN_CARD, 'e'],
      hands: { p1: ['a', 'b'], p2: [HIDDEN_CARD], p3: [], p4: [] }, piles: {},
    });
  });

  it('zeroes the RNG, drops secret vars and other players’ totals', () => {
    const view = redactState(table({}, {
      vars: { 'secret:claim:cards': 'c', 'claim:by': 'p2', round: 2 },
      totals: { p1: { squat: 3 }, p2: { plank: 30 } },
    }), 'p1');
    expect(view.rngState).toBe(0);
    expect(view.vars).toEqual({ 'claim:by': 'p2', round: 2 });
    expect(view.totals).toEqual({ p1: { squat: 3 }, p2: {} });
  });

  it('keeps your own tasks whole; others’ tasks on hidden cards show only the work', () => {
    const s = table({ hands: { p1: ['a'], p2: [], p3: [], p4: [] } }, { tasks: [task({ playerId: 'p2', cardIds: ['c'] }), task({ id: 't2', playerId: 'p1', cardIds: ['b'] })] });
    const view = redactState(s, 'p1');
    expect(view.tasks[0]).toEqual(task({ playerId: 'p2', cardIds: [HIDDEN_CARD], exerciseId: null }));
    expect(view.tasks[1]).toEqual(s.tasks[1]);
    expect(visibleCardIds(s, 'p1').has('b')).toBe(true);
  });

  it('teams (size 2, interleaved by seat): a player sees their captain’s shared hand', () => {
    const s = table({ hands: { p1: ['a'], p2: ['c'], p3: [], p4: [] } }, { vars: { 'teams:size': 2 } });
    expect(redactState(s, 'p3').zones.hands).toEqual({ p1: ['a'], p2: [HIDDEN_CARD], p3: [], p4: [] });
    expect(redactState(s, 'p4').zones.hands).toEqual({ p1: [HIDDEN_CARD], p2: ['c'], p3: [], p4: [] });
  });
});

describe('redactEvents', () => {
  it('your own card played face down stays named for you; others see a hidden card', () => {
    const before = table();
    const after = table({ hands: { p1: ['b'], p2: ['c'], p3: [], p4: [] }, table: ['a'] });
    const events = [{ type: 'CardsMoved' as const, from: 'hand:p1' as const, to: 'table' as const, cardIds: ['a'] }];
    expect(redactEvents(before, events, after, 'p1')).toEqual(events);
    expect(redactEvents(before, events, after, 'p2')).toEqual([{ ...events[0], cardIds: [HIDDEN_CARD] }]);
  });

  it('a revealed card is named in the step that reveals it, even if it ends in someone’s hand', () => {
    const before = table({ table: ['d'] });
    const after = table({ hands: { p1: ['a', 'b'], p2: ['c', 'd'], p3: [], p4: [] } });
    const events = [
      { type: 'CardsRevealed' as const, cardIds: ['d'] },
      { type: 'CardsMoved' as const, from: 'table' as const, to: 'hand:p2' as const, cardIds: ['d'] },
    ];
    expect(redactEvents(before, events, after, 'p3')).toEqual(events);
  });

  it('hides dealt cards, other players’ hidden task details, and their completed exercise key', () => {
    const before = table({ draw: ['c', 'g'], hands: { p1: [], p2: [], p3: [], p4: [] } });
    const t = task({ status: 'done' });
    const after = table({ draw: ['g'], hands: { p1: [], p2: ['c'], p3: [], p4: [] } }, { tasks: [t] });
    const events = [
      { type: 'CardsDealt' as const, zone: 'hand:p2' as const, cardIds: ['c'], faceUp: false },
      { type: 'TaskAssigned' as const, task: task({}) },
      { type: 'TaskCompleted' as const, taskId: 't1', playerId: 'p2', exerciseKey: 'squat', amount: 5 },
    ];
    expect(redactEvents(before, events, after, 'p1')).toEqual([
      { ...events[0], cardIds: [HIDDEN_CARD] },
      { type: 'TaskAssigned', task: task({ cardIds: [HIDDEN_CARD], exerciseId: null }) },
      { ...events[2], exerciseKey: HIDDEN_EXERCISE },
    ]);
    expect(redactEvents(before, events, after, 'p2')).toEqual(events);
  });
});
