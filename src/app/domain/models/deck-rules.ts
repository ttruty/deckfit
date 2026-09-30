import type { Card, Deck, DeckFilters, Equipment, Exercise, Measure, Rank, Suit } from './schemas';

export type { DeckFilters };

/** Play order used for display and tiers (§9b). */
export const PLAYING_SUITS = ['hearts', 'diamonds', 'clubs', 'spades'] as const satisfies readonly Suit[];
export const PLAYING_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const satisfies readonly Rank[];

/** Card points (§9b): number cards face value, J/Q/K 10, A 11, joker 0. */
export function rankPoints(rank: Rank): number {
  if (rank === 'A') return 11;
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  if (rank === 'JOKER') return 0;
  return Number(rank);
}

/** Default baseAmount for a card: points, ×5 seconds for timed exercises. */
export function defaultBaseAmount(rank: Rank, measure: Measure): number {
  return rankPoints(rank) * (measure === 'seconds' ? 5 : 1);
}

/** Difficulty tier of a rank (§9b): 2–5 easiest (0), 6–9 middle (1), 10/J/Q/K/A hardest (2). */
export function rankTier(rank: Rank): 0 | 1 | 2 {
  const i = (PLAYING_RANKS as readonly Rank[]).indexOf(rank);
  if (i < 0) throw new Error(`rankTier: ${rank} has no tier`);
  return i <= 3 ? 0 : i <= 7 ? 1 : 2;
}

/**
 * Applies a routine's deck filters at play time. Suits: keep listed suits (include 'joker' to
 * keep jokers). maxDifficulty: keep cards whose exercise is at most that hard (jokers pass).
 * equipment = "what I have": keep cards whose exercise needs only listed equipment; 'none'
 * is always available (jokers pass). cardCount trims what is left (see `trimToCount`), last, so
 * a short deck is still a fair sample of the deck the other filters left. Card order is preserved.
 */
export function applyDeckFilters(
  cards: readonly Card[],
  exercisesById: ReadonlyMap<string, Pick<Exercise, 'difficulty' | 'equipment'>>,
  filters: DeckFilters | undefined,
): Card[] {
  if (!filters) return [...cards];
  const have = filters.equipment ? new Set<Equipment>([...filters.equipment, 'none']) : null;
  const kept = cards.filter((card) => {
    if (filters.suits && !filters.suits.includes(card.suit)) return false;
    if (card.exerciseId === null) return true;
    const ex = exercisesById.get(card.exerciseId);
    if (!ex) return false;
    if (filters.maxDifficulty !== undefined && ex.difficulty > filters.maxDifficulty) return false;
    if (have && !ex.equipment.every((e) => have.has(e))) return false;
    return true;
  });
  return filters.cardCount === undefined ? kept : trimToCount(kept, filters.cardCount);
}

/** Deck lengths the app offers (§9g); anything at or above the deck's size means the whole deck. */
export const DECK_LENGTHS = [12, 20, 32] as const;

/**
 * Trims a deck to `count` cards so a workout ends sooner, without narrowing what it asks of you:
 * every suit keeps its share (largest remainder, so a suit that is 1/4 of the deck stays 1/4 of
 * the short one) and each share is spread evenly over that suit's ranks, so the easy, middle and
 * hard cards (§9b) all survive. The two jokers only earn a place once the count is big enough to
 * pay for them. No RNG: the same deck and count always give the same cards, and `Session.seed`
 * stays the only source of randomness (§6.1). Card order is preserved.
 */
export function trimToCount(cards: readonly Card[], count: number): Card[] {
  if (count >= cards.length || count <= 0) return [...cards];

  // Groups in the order the deck lists them, so the result is deck order too.
  const groups = new Map<Suit, Card[]>();
  for (const card of cards) {
    const group = groups.get(card.suit);
    if (group) group.push(card);
    else groups.set(card.suit, [card]);
  }
  const bySuit = [...groups.values()];
  const shares = share(bySuit.map((g) => g.length), count);

  const keep = new Set<string>();
  bySuit.forEach((group, i) => {
    const take = shares[i];
    // Evenly spaced picks, biased to the middle of each step: 5 of 13 → ranks 3, 5, 8, J, K.
    for (let j = 0; j < take; j++) keep.add(group[Math.floor(((j + 0.5) * group.length) / take)].id);
  });
  return cards.filter((c) => keep.has(c.id));
}

/** Splits `count` across `sizes` in proportion, largest remainder first (ties → the bigger group). */
function share(sizes: readonly number[], count: number): number[] {
  const total = sizes.reduce((a, b) => a + b, 0);
  const exact = sizes.map((size) => (count * size) / total);
  const out = exact.map(Math.floor);
  const order = sizes
    .map((size, i) => ({ i, size, rest: exact[i] - out[i] }))
    .sort((a, b) => b.rest - a.rest || b.size - a.size || a.i - b.i);
  for (let left = count - out.reduce((a, b) => a + b, 0), k = 0; left > 0; left--, k++) out[order[k % order.length].i]++;
  return out;
}

export type AutoFillResult = { ok: true; cards: Card[]; picked: [Exercise, Exercise, Exercise] } | { ok: false; reason: string };

/**
 * "Auto-fill suit": choose 3 exercises for a suit and assign them by rank tier (§9b).
 * Candidates work any of the suit's muscle groups (and match the deck's category when it
 * has one), sorted by difficulty then name; picks the easiest, the median, and the hardest.
 * Amounts reset to the default for the new exercise.
 */
export function autoFillSuit(deck: Deck, suit: Suit, exercises: readonly Exercise[]): AutoFillResult {
  if (suit === 'joker') return { ok: false, reason: 'Jokers have no exercise to fill.' };
  const mapping = deck.suits.find((s) => s.suit === suit);
  if (!mapping) return { ok: false, reason: `The deck has no ${suit} mapping.` };
  if (!mapping.muscleGroups.length) return { ok: false, reason: `Pick muscle groups for ${mapping.label} first.` };

  const candidates = exercises
    .filter((e) => e.muscleGroups.some((m) => mapping.muscleGroups.includes(m)))
    .filter((e) => !deck.category || e.category === deck.category)
    .sort((a, b) => a.difficulty - b.difficulty || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  if (candidates.length < 3) {
    const where = deck.category ? ` in this deck's category` : '';
    return { ok: false, reason: `Need at least 3 exercises for ${mapping.label}${where}; found ${candidates.length}.` };
  }

  const picked: [Exercise, Exercise, Exercise] = [
    candidates[0],
    candidates[Math.floor((candidates.length - 1) / 2)],
    candidates[candidates.length - 1],
  ];
  const cards = deck.cards.map((c) => {
    if (c.suit !== suit) return c;
    const ex = picked[rankTier(c.rank)];
    return { ...c, exerciseId: ex.id, baseAmount: defaultBaseAmount(c.rank, ex.measure) };
  });
  return { ok: true, cards, picked };
}
