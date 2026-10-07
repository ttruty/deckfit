import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DECK_LENGTHS, PLAYING_RANKS, PLAYING_SUITS, amountBand, buildDeck, deckSize, rankPoints, rankTier, suggestPool, trimToCount } from './deck-rules';
import { DecksFileSchema, ExercisesFileSchema, type Deck, type Exercise } from './schemas';

const read = (f: string): unknown => JSON.parse(readFileSync(join(process.cwd(), 'src/assets/content', f), 'utf8'));
const { decks } = DecksFileSchema.parse(read('decks.json'));
const { exercises } = ExercisesFileSchema.parse(read('exercises.json'));

describe('rank rules', () => {
  it('points: face value, J/Q/K 10, A 11, joker 0', () => {
    expect(PLAYING_RANKS.map(rankPoints)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10, 11]);
    expect(rankPoints('JOKER')).toBe(0);
  });

  it('tiers: 2–5, 6–9, 10–A', () => {
    expect(PLAYING_RANKS.map(rankTier)).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 2]);
    expect(() => rankTier('JOKER')).toThrow();
  });
});

describe('suggestPool', () => {
  const bodyweight = structuredClone(decks.find((d) => d.id === 'deck-bodyweight')!);
  const ex = (over: Partial<Exercise>): Exercise => ({
    id: 'x', name: 'X', description: '', category: 'bodyweight', muscleGroups: ['legs'], equipment: ['none'],
    difficulty: 1, measure: 'reps', figure: { start: 'stand', end: 'squat', prop: null }, builtIn: false, ...over,
  });
  const empty = (deck: Deck): Deck => ({ ...deck, suits: deck.suits.map((s) => ({ ...s, exerciseIds: [] })) });

  it('picks three that span the difficulty range, from the deck’s own category', () => {
    const pool = [
      ex({ id: 'e5', name: 'E', difficulty: 5, measure: 'seconds' }),
      ex({ id: 'a1', name: 'A', difficulty: 1 }),
      ex({ id: 'c3', name: 'C', difficulty: 3 }),
      ex({ id: 'b2', name: 'B', difficulty: 2 }),
      ex({ id: 'd4', name: 'D', difficulty: 4 }),
      ex({ id: 'core', muscleGroups: ['core'] }), // wrong muscle group
      ex({ id: 'yoga', category: 'yoga' }), // wrong category
    ];
    const result = suggestPool(empty(bodyweight), 'hearts', pool);
    if (!result.ok) throw new Error(result.reason);
    expect(result.exercises.map((e) => e.id)).toEqual(['a1', 'c3', 'e5']);
  });

  it('never suggests what the group already holds', () => {
    const pool = [ex({ id: 'a1', difficulty: 1 }), ex({ id: 'b2', name: 'B', difficulty: 2 })];
    const withOne: Deck = { ...empty(bodyweight), suits: empty(bodyweight).suits.map((s) => (s.suit === 'hearts' ? { ...s, exerciseIds: ['a1'] } : s)) };
    const result = suggestPool(withOne, 'hearts', pool);
    if (!result.ok) throw new Error(result.reason);
    expect(result.exercises.map((e) => e.id)).toEqual(['b2']);
  });

  it('explains itself when it cannot help', () => {
    expect(suggestPool(bodyweight, 'joker', exercises)).toEqual({ ok: false, reason: 'Jokers have no exercises.' });
    const noGroups: Deck = { ...bodyweight, suits: bodyweight.suits.map((s) => ({ ...s, muscleGroups: [] })) };
    expect(suggestPool(noGroups, 'hearts', exercises)).toMatchObject({ ok: false, reason: /muscle groups/ });
    expect(suggestPool(empty(bodyweight), 'hearts', [])).toMatchObject({ ok: false, reason: /No more exercises/ });
  });
});

describe('buildDeck', () => {
  const deck = decks.find((d) => d.id === 'deck-bodyweight')!;
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const poolOf = (suit: string) => deck.suits.find((s) => s.suit === suit)!.exerciseIds;

  it('deals 13 cards per group plus two jokers', () => {
    const cards = buildDeck(deck, byId, 42);
    expect(cards).toHaveLength(54);
    for (const suit of PLAYING_SUITS) {
      expect(cards.filter((c) => c.suit === suit).map((c) => c.rank).sort()).toEqual([...PLAYING_RANKS].sort());
    }
    expect(cards.filter((c) => c.suit === 'joker')).toHaveLength(2);
    expect(new Set(cards.map((c) => c.id)).size).toBe(54);
  });

  it('is the same deal for the same seed, and a different one otherwise', () => {
    const body = (seed: number) => buildDeck(deck, byId, seed).map((c) => `${c.id}:${c.exerciseId}:${c.baseAmount}`);
    expect(body(42)).toEqual(body(42));
    expect(body(42)).not.toEqual(body(43));
  });

  it('only ever deals exercises from that group, and spreads them evenly', () => {
    const cards = buildDeck(deck, byId, 7);
    for (const suit of PLAYING_SUITS) {
      const used = cards.filter((c) => c.suit === suit).map((c) => c.exerciseId!);
      expect(used.every((id) => poolOf(suit).includes(id))).toBe(true);
      // 13 ranks over a pool of 3: nobody gets fewer than 4 or more than 5.
      const counts = poolOf(suit).map((id) => used.filter((u) => u === id).length);
      expect(Math.min(...counts), `${suit} ${counts}`).toBeGreaterThanOrEqual(4);
      expect(Math.max(...counts), `${suit} ${counts}`).toBeLessThanOrEqual(5);
    }
  });

  it('keeps every amount inside its rank’s band, ×5 for a timed exercise', () => {
    for (const seed of [1, 2, 3, 99]) {
      for (const card of buildDeck(deck, byId, seed)) {
        if (!card.exerciseId) continue;
        const unit = byId.get(card.exerciseId)!.measure === 'seconds' ? 5 : 1;
        const [low, high] = amountBand(card.rank);
        expect(card.baseAmount, `${card.id} seed ${seed}`).toBeGreaterThanOrEqual(low * unit);
        expect(card.baseAmount, `${card.id} seed ${seed}`).toBeLessThanOrEqual(high * unit);
      }
    }
  });

  it('bands follow the rank, and faceCardValue / aceValue move the top ones', () => {
    expect(amountBand('2')).toEqual([1, 3]);
    expect(amountBand('7')).toEqual([5, 10]);
    expect(amountBand('K')).toEqual([7, 14]);
    expect(amountBand('A')).toEqual([8, 15]);
    // A deck where face cards are worth 20 deals bigger face cards, and nothing else changes.
    expect(amountBand('K', { faceCardValue: 20 })).toEqual([14, 28]);
    expect(amountBand('A', { aceValue: 1 })).toEqual([1, 1]);
    // 0 still means "free": the band doesn't round up to one, so the task is dropped as before.
    expect(amountBand('A', { aceValue: 0 })).toEqual([0, 0]);
    expect(amountBand('7', { faceCardValue: 20, aceValue: 1 })).toEqual([5, 10]);
  });

  it('filters narrow the pools, not the deal: a filtered deck is still a full deck', () => {
    const kettlebell = decks.find((d) => d.id === 'deck-kettlebell')!;
    expect(buildDeck(kettlebell, byId, 1, { filters: { equipment: ['kettlebell'] } })).toHaveLength(54);
    // No kettlebell: every group empties, so only the jokers are left.
    expect(buildDeck(kettlebell, byId, 1, { filters: { equipment: [] } })).toHaveLength(2);

    const easy = buildDeck(deck, byId, 1, { filters: { maxDifficulty: 1 } });
    expect(easy.filter((c) => c.exerciseId).every((c) => byId.get(c.exerciseId!)!.difficulty <= 1)).toBe(true);
  });

  it('suits choose which groups are dealt, jokers included', () => {
    expect(buildDeck(deck, byId, 1, { filters: { suits: ['hearts'] } })).toHaveLength(13);
    expect(buildDeck(deck, byId, 1, { filters: { suits: ['hearts', 'joker'] } })).toHaveLength(15);
  });

  it('cardCount trims the deal, after everything else (§9g)', () => {
    expect(buildDeck(deck, byId, 1, { filters: { cardCount: 20 } })).toHaveLength(20);
    expect(buildDeck(deck, byId, 1, { filters: { suits: ['hearts'], cardCount: 20 } })).toHaveLength(13);
    expect(deckSize(deck, byId, { cardCount: 32 })).toBe(32);
  });

  it('a group whose exercises are all unknown deals nothing', () => {
    const broken: Deck = { ...deck, suits: deck.suits.map((s) => (s.suit === 'hearts' ? { ...s, exerciseIds: ['gone'] } : s)) };
    expect(buildDeck(broken, byId, 1).filter((c) => c.suit === 'hearts')).toEqual([]);
    expect(buildDeck(broken, byId, 1)).toHaveLength(41);
  });
});

describe('trimToCount', () => {
  const source = decks.find((d) => d.id === 'deck-bodyweight')!;
  const deck = { cards: buildDeck(source, new Map(exercises.map((e) => [e.id, e])), 1) };
  const suitsOf = (cards: readonly { suit: string }[]) =>
    cards.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.suit]: (acc[c.suit] ?? 0) + 1 }), {});

  it('returns the whole deck when the count reaches it', () => {
    for (const n of [54, 60]) expect(trimToCount(deck.cards, n)).toHaveLength(54);
  });

  it('gives every suit its share and spends jokers last', () => {
    expect(suitsOf(trimToCount(deck.cards, 12))).toEqual({ hearts: 3, diamonds: 3, clubs: 3, spades: 3 });
    expect(suitsOf(trimToCount(deck.cards, 20))).toEqual({ hearts: 5, diamonds: 5, clubs: 5, spades: 5 });
    // 32 of 54 finally pays for a joker; the 3 left over go to the first suits in deck order.
    expect(suitsOf(trimToCount(deck.cards, 32))).toEqual({ hearts: 8, diamonds: 8, clubs: 8, spades: 7, joker: 1 });
  });

  it('keeps easy, middle and hard cards in every suit (§9b tiers)', () => {
    for (const n of DECK_LENGTHS) {
      const kept = trimToCount(deck.cards, n);
      for (const suit of ['hearts', 'diamonds', 'clubs', 'spades'] as const) {
        const tiers = new Set(kept.filter((c) => c.suit === suit).map((c) => rankTier(c.rank)));
        expect([...tiers].sort(), `${n} cards, ${suit}`).toEqual([0, 1, 2]);
      }
    }
  });

  it('is deterministic and keeps deck order', () => {
    const once = trimToCount(deck.cards, 20);
    expect(once.map((c) => c.id)).toEqual(trimToCount(deck.cards, 20).map((c) => c.id));
    const order = deck.cards.map((c) => c.id);
    expect(once.map((c) => order.indexOf(c.id))).toEqual([...once.map((c) => order.indexOf(c.id))].sort((a, b) => a - b));
  });

  it('handles counts smaller than the number of suits, and odd shapes', () => {
    expect(trimToCount(deck.cards, 3)).toHaveLength(3);
    expect(trimToCount(deck.cards, 1)).toHaveLength(1);
    expect(trimToCount(deck.cards.slice(0, 5), 5)).toHaveLength(5);
    expect(trimToCount([], 4)).toEqual([]);
  });
});
