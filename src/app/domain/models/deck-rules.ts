import { createRng, shuffle, type Rng } from '../shuffle';
import type { Card, Deck, DeckFilters, Equipment, Exercise, Rank, Suit } from './schemas';

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

/** Difficulty tier of a rank (§9b): 2-5 easiest (0), 6-9 middle (1), 10/J/Q/K/A hardest (2). */
export function rankTier(rank: Rank): 0 | 1 | 2 {
  const i = (PLAYING_RANKS as readonly Rank[]).indexOf(rank);
  if (i < 0) throw new Error(`rankTier: ${rank} has no tier`);
  return i <= 3 ? 0 : i <= 7 ? 1 : 2;
}

/** What a card can ask for, before intensity: the rank sets the band, the deal picks in it. */
export const AMOUNT_SPREAD = { low: 0.7, high: 1.4 } as const;

/**
 * The range a rank's amount is drawn from, in card points. A 3 is always light and an Ace
 * always heavy — the band is centred on the rank's own value (§9b), so the deck stays legible
 * and a game that compares or matches ranks still means something. `faceCardValue` and
 * `aceValue` set the centre for J/Q/K and A, which is what those settings now do.
 */
export function amountBand(rank: Rank, settings: DealSettings = {}): [number, number] {
  const points =
    rank === 'J' || rank === 'Q' || rank === 'K'
      ? (settings.faceCardValue ?? 10)
      : rank === 'A'
        ? (settings.aceValue ?? 11)
        : rankPoints(rank);
  // A setting of 0 means "that card is free", so the band stays at zero rather than rounding up
  // to one; anything else asks for at least one rep.
  if (points <= 0) return [0, 0];
  const low = Math.max(1, Math.round(points * AMOUNT_SPREAD.low));
  return [low, Math.max(low, Math.round(points * AMOUNT_SPREAD.high))];
}

export interface DealSettings {
  faceCardValue?: number;
  aceValue?: number;
}

export interface DealOptions extends DealSettings {
  filters?: DeckFilters;
}

/** Jokers per deck (§9b): two, whatever the pools hold. */
export const JOKERS_PER_DECK = 2;

type ExerciseFacts = Pick<Exercise, 'difficulty' | 'equipment' | 'measure'>;

/**
 * Deals a deck: one card per rank per suit that still has exercises, each card a random
 * exercise from that suit's pool and a random amount inside its rank's band. Everything comes
 * from `seed`, so the same seed always deals the same deck — `Session.seed` stays the only
 * source of randomness (§6.1) and a replay reproduces the workout exactly.
 *
 * Filters narrow the pools first (difficulty and equipment), so a filtered deck is still a
 * full deck of what you *can* do rather than a deck with holes in it; `suits` drops whole
 * groups and `cardCount` trims the result (§9g).
 */
export function buildDeck(
  deck: Pick<Deck, 'suits'>,
  exercisesById: ReadonlyMap<string, ExerciseFacts>,
  seed: number,
  opts: DealOptions = {},
): Card[] {
  const rng = createRng(seed);
  const filters = opts.filters;
  const have = filters?.equipment ? new Set<Equipment>([...filters.equipment, 'none']) : null;
  const cards: Card[] = [];

  for (const suit of PLAYING_SUITS) {
    const mapping = deck.suits.find((s) => s.suit === suit);
    if (!mapping || (filters?.suits && !filters.suits.includes(suit))) continue;
    const pool = mapping.exerciseIds
      .map((id) => [id, exercisesById.get(id)] as const)
      .filter((pair): pair is readonly [string, ExerciseFacts] => {
        const ex = pair[1];
        if (!ex) return false;
        if (filters?.maxDifficulty !== undefined && ex.difficulty > filters.maxDifficulty) return false;
        return !have || ex.equipment.every((e) => have.has(e));
      });
    if (!pool.length) continue;

    const picks = dealFrom(pool, PLAYING_RANKS.length, rng);
    PLAYING_RANKS.forEach((rank, i) => {
      const [exerciseId, ex] = picks[i];
      const [low, high] = amountBand(rank, opts);
      const points = low + rng.int(high - low + 1);
      cards.push({
        id: `${suit}-${rank}`,
        suit,
        rank,
        exerciseId,
        baseAmount: points * (ex.measure === 'seconds' ? SECONDS_PER_POINT : 1),
      });
    });
  }

  if (!filters?.suits || filters.suits.includes('joker')) {
    for (let i = 1; i <= JOKERS_PER_DECK; i++) {
      cards.push({ id: `joker-${i}`, suit: 'joker', rank: 'JOKER', exerciseId: null, baseAmount: 0 });
    }
  }
  return filters?.cardCount === undefined ? cards : trimToCount(cards, filters.cardCount);
}

/** Timed exercises ask for 5 seconds per point (§9b); kept here so the dealer stays pure. */
const SECONDS_PER_POINT = 5;

/**
 * `count` picks from a pool, spread evenly: the pool is repeated until it is long enough and
 * shuffled, so three exercises over thirteen ranks come out 4/4/5 rather than 9/3/1.
 */
function dealFrom<T>(pool: readonly T[], count: number, rng: Rng): T[] {
  const bag: T[] = [];
  while (bag.length < count) bag.push(...shuffle(pool, rng));
  return bag.slice(0, count);
}

/**
 * How many cards a deck deals under these filters — the same number `buildDeck` returns,
 * without needing a seed (the deal is random in what, never in how many).
 */
export function deckSize(
  deck: Pick<Deck, 'suits'>,
  exercisesById: ReadonlyMap<string, ExerciseFacts>,
  filters?: DeckFilters,
): number {
  return buildDeck(deck, exercisesById, 1, { filters }).length;
}

/** Every exercise a deck can deal, in suit order and without repeats. */
export function deckExerciseIds(deck: Pick<Deck, 'suits'>): string[] {
  return [...new Set(deck.suits.flatMap((s) => s.exerciseIds))];
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

export type SuggestResult = { ok: true; exercises: Exercise[] } | { ok: false; reason: string };

/** How many exercises "Suggest" puts in an empty group — the built-in decks' own shape (§9b). */
export const SUGGESTED_POOL_SIZE = 3;

/**
 * "Suggest exercises" for a group: candidates work any of the group's muscle groups (and match
 * the deck's category when it has one), and the pick spans the range — easiest, median, hardest
 * — so the group holds an easy day and a hard one. Anything already in the group is kept.
 */
export function suggestPool(deck: Pick<Deck, 'suits' | 'category'>, suit: Suit, exercises: readonly Exercise[]): SuggestResult {
  if (suit === 'joker') return { ok: false, reason: 'Jokers have no exercises.' };
  const mapping = deck.suits.find((s) => s.suit === suit);
  if (!mapping) return { ok: false, reason: `The deck has no ${suit} group.` };
  if (!mapping.muscleGroups.length) return { ok: false, reason: `Pick muscle groups for ${mapping.label} first.` };

  const candidates = exercises
    .filter((e) => e.muscleGroups.some((m) => mapping.muscleGroups.includes(m)))
    .filter((e) => !deck.category || e.category === deck.category)
    .filter((e) => !mapping.exerciseIds.includes(e.id))
    .sort((a, b) => a.difficulty - b.difficulty || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  if (!candidates.length) {
    const where = deck.category ? ` in this deck's category` : '';
    return { ok: false, reason: `No more exercises for ${mapping.label}${where}.` };
  }

  const want = Math.min(SUGGESTED_POOL_SIZE, candidates.length);
  const spread = [...new Set(Array.from({ length: want }, (_, i) => Math.round((i * (candidates.length - 1)) / Math.max(1, want - 1))))];
  return { ok: true, exercises: spread.map((i) => candidates[i]) };
}
