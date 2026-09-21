import type { Card, GameSettings, Measure } from '../models/schemas';
import { BONUS_CARDIO_SECONDS_PER_JOKER, REST_SECONDS_PER_JOKER, cardAmount, planTasks, scaleAmount, workScale, type AmountSource } from './amounts';

const settings = (over: Partial<GameSettings> = {}): AmountSource['settings'] => ({
  repMultiplier: 1, faceCardValue: 10, aceValue: 11, jokerRule: 'skip', ...over,
});

const MEASURES: Record<string, Measure> = { squat: 'reps', plank: 'seconds', lunge: 'reps' };
const src = (over: Partial<GameSettings> = {}): AmountSource => ({ settings: settings(over), measureOf: (id) => MEASURES[id] });

const card = (rank: Card['rank'], exerciseId: string | null = 'squat', id = `${exerciseId}-${rank}`): Card => {
  const n = Number(rank);
  const points = Number.isNaN(n) ? (rank === 'A' ? 11 : rank === 'JOKER' ? 0 : 10) : n;
  const suit = exerciseId === null ? 'joker' : 'hearts';
  return { id, suit, rank, exerciseId, baseAmount: exerciseId && MEASURES[exerciseId] === 'seconds' ? points * 5 : points };
};

describe('cardAmount', () => {
  it('uses baseAmount for number cards (already ×5 when timed)', () => {
    expect(cardAmount(card('7'), 'reps', settings())).toBe(7);
    expect(cardAmount(card('7', 'plank'), 'seconds', settings())).toBe(35);
    expect(cardAmount({ ...card('7'), baseAmount: 12 }, 'reps', settings())).toBe(12); // deck-edited amount wins
  });

  it('uses faceCardValue for J/Q/K and aceValue for A, ×5 when timed', () => {
    const s = settings({ faceCardValue: 8, aceValue: 15 });
    expect(['J', 'Q', 'K'].map((r) => cardAmount(card(r as Card['rank']), 'reps', s))).toEqual([8, 8, 8]);
    expect(cardAmount(card('A'), 'reps', s)).toBe(15);
    expect(cardAmount(card('K', 'plank'), 'seconds', s)).toBe(40);
    expect(cardAmount(card('A', 'plank'), 'seconds', s)).toBe(75);
  });

  it('refuses jokers', () => {
    expect(() => cardAmount(card('JOKER', null), 'reps', settings())).toThrow();
  });
});

describe('scaleAmount', () => {
  it.each([
    [10, 1, 10],
    [7, 1.5, 11], // 10.5 rounds half up
    [5, 0.5, 3], // 2.5 rounds half up
    [3, 0.5, 2], // 1.5
    [11, 3, 33],
  ])('%i × %f = %i', (raw, repMultiplier, expected) => {
    expect(scaleAmount(raw, 'reps', settings({ repMultiplier }))).toBe(expected);
  });

  it('scales reps and seconds by intensity, and reads a missing one as moderate', () => {
    expect([10, 30].map((raw) => scaleAmount(raw, 'reps', settings({ intensity: 'low' })))).toEqual([7, 21]);
    expect([10, 30].map((raw) => scaleAmount(raw, 'reps', settings({ intensity: 'moderate' })))).toEqual([10, 30]);
    expect([10, 30].map((raw) => scaleAmount(raw, 'reps', settings({ intensity: 'high' })))).toEqual([14, 42]);
    expect(scaleAmount(30, 'seconds', settings({ intensity: 'high' }))).toBe(42);
    expect(scaleAmount(10, 'reps', settings())).toBe(10); // no intensity saved = moderate
  });

  it('multiplies intensity by the rep multiplier, and caps after both', () => {
    expect(workScale({ intensity: 'high', repMultiplier: 1.5 })).toBeCloseTo(2.1);
    expect(scaleAmount(10, 'reps', settings({ intensity: 'high', repMultiplier: 1.5 }))).toBe(21);
    expect(scaleAmount(10, 'reps', settings({ intensity: 'high', repMultiplier: 1.5, maxRepCap: 15 }))).toBe(15);
    expect(scaleAmount(10, 'reps', settings({ intensity: 'low', repMultiplier: 0.5 }))).toBe(4); // 3.5 rounds half up
  });

  it('caps reps at maxRepCap and seconds at maxRepCap × 5', () => {
    const s = settings({ repMultiplier: 3, maxRepCap: 25 });
    expect(scaleAmount(10, 'reps', s)).toBe(25);
    expect(scaleAmount(8, 'reps', s)).toBe(24);
    expect(scaleAmount(50, 'seconds', s)).toBe(125);
    expect(scaleAmount(40, 'seconds', s)).toBe(120);
  });
});

describe('planTasks', () => {
  it('makes one task per exercise, summing cards, in order of first appearance', () => {
    const drafts = planTasks([card('3', 'lunge'), card('4'), card('K', 'lunge'), card('2', 'plank')], src());
    expect(drafts).toEqual([
      { cardIds: ['lunge-3', 'lunge-K'], kind: 'exercise', exerciseId: 'lunge', measure: 'reps', amount: 13 },
      { cardIds: ['squat-4'], kind: 'exercise', exerciseId: 'squat', measure: 'reps', amount: 4 },
      { cardIds: ['plank-2'], kind: 'exercise', exerciseId: 'plank', measure: 'seconds', amount: 10 },
    ]);
  });

  it('applies the multiplier to the sum, then the cap', () => {
    // (5 + 6) × 1.5 = 16.5 → 17, capped at 15
    expect(planTasks([card('5'), card('6')], src({ repMultiplier: 1.5 }))[0].amount).toBe(17);
    expect(planTasks([card('5'), card('6')], src({ repMultiplier: 1.5, maxRepCap: 15 }))[0].amount).toBe(15);
  });

  it('a high-intensity task asks for more of the same exercise; rest never changes', () => {
    const cards = [card('5'), card('6'), card('JOKER', null)];
    expect(planTasks(cards, src({ intensity: 'high', jokerRule: 'rest' }))).toEqual([
      { cardIds: ['squat-5', 'squat-6'], kind: 'exercise', exerciseId: 'squat', measure: 'reps', amount: 15 },
      { cardIds: ['null-JOKER'], kind: 'rest', exerciseId: null, measure: 'seconds', amount: REST_SECONDS_PER_JOKER },
    ]);
    expect(planTasks(cards, src({ intensity: 'low', jokerRule: 'rest' }))[0].amount).toBe(8); // 11 × 0.7 = 7.7
  });

  it('drops zero-amount tasks (e.g. aceValue 0)', () => {
    expect(planTasks([card('A')], src({ aceValue: 0 }))).toEqual([]);
  });

  it('throws for a card whose exercise is unknown', () => {
    expect(() => planTasks([card('2', 'nope')], src())).toThrow(/unknown exercise/);
  });

  describe('jokers', () => {
    const jokers = [card('JOKER', null, 'j1'), card('2'), card('JOKER', null, 'j2')];

    it('skip: no task', () => {
      expect(planTasks(jokers, src({ jokerRule: 'skip' })).map((d) => d.kind)).toEqual(['exercise']);
    });

    it('rest: 30s per joker, ignores multiplier and cap', () => {
      const [rest] = planTasks(jokers, src({ jokerRule: 'rest', repMultiplier: 3, maxRepCap: 1 }));
      expect(rest).toEqual({ cardIds: ['j1', 'j2'], kind: 'rest', exerciseId: null, measure: 'seconds', amount: 2 * REST_SECONDS_PER_JOKER });
    });

    it('wild: faceCardValue reps per joker, multiplied and capped', () => {
      const [wild] = planTasks(jokers, src({ jokerRule: 'wild', faceCardValue: 10, repMultiplier: 1.5 }));
      expect(wild).toEqual({ cardIds: ['j1', 'j2'], kind: 'wild', exerciseId: null, measure: 'reps', amount: 30 });
      expect(planTasks(jokers, src({ jokerRule: 'wild', maxRepCap: 12 }))[0].amount).toBe(12);
    });

    it('bonus-cardio: 60s per joker, multiplied and capped (cap × 5 seconds)', () => {
      const [cardio] = planTasks([card('JOKER', null, 'j1')], src({ jokerRule: 'bonus-cardio', repMultiplier: 0.5 }));
      expect(cardio).toMatchObject({ kind: 'bonus-cardio', measure: 'seconds', amount: BONUS_CARDIO_SECONDS_PER_JOKER / 2 });
      expect(planTasks(jokers, src({ jokerRule: 'bonus-cardio', maxRepCap: 20 }))[0].amount).toBe(100);
    });
  });
});
