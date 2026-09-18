import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLAYING_RANKS, applyDeckFilters, autoFillSuit, defaultBaseAmount, rankPoints, rankTier } from './deck-rules';
import { DecksFileSchema, ExercisesFileSchema, type Deck, type Exercise } from './schemas';

const read = (f: string): unknown => JSON.parse(readFileSync(join(process.cwd(), 'src/assets/content', f), 'utf8'));
const { decks } = DecksFileSchema.parse(read('decks.json'));
const { exercises } = ExercisesFileSchema.parse(read('exercises.json'));

describe('rank rules', () => {
  it('points: face value, J/Q/K 10, A 11, joker 0', () => {
    expect(PLAYING_RANKS.map(rankPoints)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10, 11]);
    expect(rankPoints('JOKER')).toBe(0);
  });

  it('default amount ×5 for timed exercises', () => {
    expect(defaultBaseAmount('7', 'reps')).toBe(7);
    expect(defaultBaseAmount('A', 'seconds')).toBe(55);
  });

  it('tiers: 2–5, 6–9, 10–A', () => {
    expect(PLAYING_RANKS.map(rankTier)).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 2]);
    expect(() => rankTier('JOKER')).toThrow();
  });
});

describe('autoFillSuit', () => {
  const bodyweight = structuredClone(decks.find((d) => d.id === 'deck-bodyweight')!);
  const ex = (over: Partial<Exercise>): Exercise => ({
    id: 'x', name: 'X', description: '', category: 'bodyweight', muscleGroups: ['legs'], equipment: ['none'],
    difficulty: 1, measure: 'reps', figure: { start: 'stand', end: 'squat', prop: null }, builtIn: false, ...over,
  });

  it('on each built-in suit, picks that suit’s 3 exercises with difficulty rising by tier', () => {
    // Exactly 3 candidates per suit, so easiest/median/hardest are the 3 in use. Order may differ
    // from the generator's where difficulties tie (auto-fill breaks ties by name).
    for (const deck of decks) {
      for (const suit of ['hearts', 'diamonds', 'clubs', 'spades'] as const) {
        const used = new Set(deck.cards.filter((c) => c.suit === suit).map((c) => c.exerciseId));
        const pool = exercises.filter((e) => used.has(e.id));
        const result = autoFillSuit(deck, suit, pool);
        if (!result.ok) throw new Error(`${deck.id} ${suit}: ${result.reason}`);
        expect(new Set(result.picked.map((e) => e.id))).toEqual(used);
        const [a, b, c] = result.picked.map((e) => e.difficulty);
        expect(a <= b && b <= c, `${deck.id} ${suit}`).toBe(true);
      }
    }
  });

  it('picks easiest, median, hardest by difficulty and assigns by tier with default amounts', () => {
    const pool = [
      ex({ id: 'e5', name: 'E', difficulty: 5, measure: 'seconds' }),
      ex({ id: 'a1', name: 'A', difficulty: 1 }),
      ex({ id: 'c3', name: 'C', difficulty: 3 }),
      ex({ id: 'b2', name: 'B', difficulty: 2 }),
      ex({ id: 'd4', name: 'D', difficulty: 4 }),
      ex({ id: 'core', muscleGroups: ['core'] }),
      ex({ id: 'yoga', category: 'yoga' }),
    ];
    const result = autoFillSuit(bodyweight, 'hearts', pool);
    if (!result.ok) throw new Error(result.reason);
    expect(result.picked.map((e) => e.id)).toEqual(['a1', 'c3', 'e5']);
    const hearts = result.cards.filter((c) => c.suit === 'hearts');
    const byRank = Object.fromEntries(hearts.map((c) => [c.rank, [c.exerciseId, c.baseAmount]]));
    expect(byRank['2']).toEqual(['a1', 2]);
    expect(byRank['9']).toEqual(['c3', 9]);
    expect(byRank['10']).toEqual(['e5', 50]);
    expect(byRank['A']).toEqual(['e5', 55]);
    expect(result.cards.filter((c) => c.suit !== 'hearts')).toEqual(bodyweight.cards.filter((c) => c.suit !== 'hearts'));
  });

  it('ignores category when the deck has none', () => {
    const { category: _, ...uncategorized } = bodyweight;
    const pool = [ex({ id: 'a', category: 'yoga' }), ex({ id: 'b', category: 'running', difficulty: 2 }), ex({ id: 'c', difficulty: 3 })];
    expect(autoFillSuit(uncategorized as Deck, 'hearts', pool).ok).toBe(true);
    expect(autoFillSuit(bodyweight, 'hearts', pool).ok).toBe(false);
  });

  it('explains why it cannot fill', () => {
    expect(autoFillSuit(bodyweight, 'joker', exercises)).toEqual({ ok: false, reason: 'Jokers have no exercise to fill.' });
    const noGroups = { ...bodyweight, suits: bodyweight.suits.map((s) => (s.suit === 'hearts' ? { ...s, muscleGroups: [] } : s)) };
    expect(autoFillSuit(noGroups, 'hearts', exercises)).toMatchObject({ ok: false, reason: 'Pick muscle groups for Legs first.' });
    expect(autoFillSuit(bodyweight, 'hearts', [ex({})])).toMatchObject({ ok: false, reason: expect.stringMatching(/found 1/) });
  });
});

describe('applyDeckFilters', () => {
  const deck = decks.find((d) => d.id === 'deck-kettlebell')!;
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const count = (f: Parameters<typeof applyDeckFilters>[2]) => applyDeckFilters(deck.cards, byId, f).length;

  it('passes everything through without filters', () => {
    expect(count(undefined)).toBe(54);
    expect(count({})).toBe(54);
  });

  it('keeps only listed suits; jokers only when listed', () => {
    expect(count({ suits: ['hearts'] })).toBe(13);
    expect(count({ suits: ['hearts', 'joker'] })).toBe(15);
  });

  it('caps exercise difficulty; jokers always pass', () => {
    const kept = applyDeckFilters(deck.cards, byId, { maxDifficulty: 1 });
    expect(kept.filter((c) => c.exerciseId).every((c) => byId.get(c.exerciseId!)!.difficulty <= 1)).toBe(true);
    expect(kept.filter((c) => c.suit === 'joker')).toHaveLength(2);
  });

  it('equipment means "what I have": all needed items must be available ("none" is free)', () => {
    expect(count({ equipment: [] })).toBe(2); // kettlebell deck needs kettlebells: only jokers remain
    expect(count({ equipment: ['kettlebell'] })).toBe(54);
    const bodyweight = decks.find((d) => d.id === 'deck-bodyweight')!;
    expect(applyDeckFilters(bodyweight.cards, byId, { equipment: [] })).toHaveLength(54);
  });

  it('drops cards whose exercise is unknown and preserves order', () => {
    const cards = [{ ...deck.cards[0], exerciseId: 'gone' }, deck.cards[1], deck.cards[2]];
    expect(applyDeckFilters(cards, byId, {}).map((c) => c.id)).toEqual([deck.cards[1].id, deck.cards[2].id]);
  });
});
