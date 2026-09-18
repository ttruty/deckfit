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
 * is always available (jokers pass). Card order is preserved.
 */
export function applyDeckFilters(
  cards: readonly Card[],
  exercisesById: ReadonlyMap<string, Pick<Exercise, 'difficulty' | 'equipment'>>,
  filters: DeckFilters | undefined,
): Card[] {
  if (!filters) return [...cards];
  const have = filters.equipment ? new Set<Equipment>([...filters.equipment, 'none']) : null;
  return cards.filter((card) => {
    if (filters.suits && !filters.suits.includes(card.suit)) return false;
    if (card.exerciseId === null) return true;
    const ex = exercisesById.get(card.exerciseId);
    if (!ex) return false;
    if (filters.maxDifficulty !== undefined && ex.difficulty > filters.maxDifficulty) return false;
    if (have && !ex.equipment.every((e) => have.has(e))) return false;
    return true;
  });
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
