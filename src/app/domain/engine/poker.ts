import type { Card } from '../models/schemas';

/** Poker categories, weakest first. */
export const POKER_CATEGORIES = [
  'high-card', 'pair', 'two-pair', 'three-of-a-kind', 'straight', 'flush', 'full-house', 'four-of-a-kind', 'straight-flush',
] as const;
export type PokerCategory = (typeof POKER_CATEGORIES)[number];

export interface PokerHand {
  category: PokerCategory;
  /** Tie-breakers, most significant first (category index, then ranks 2..14). Compare lexicographically. */
  score: number[];
}

const VALUE: Record<string, number> = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 };

/**
 * Evaluates up to five cards (fewer is fine: missing cards simply can't form straights/flushes).
 * Jokers are dead cards: they count for nothing. Straights may be A-2-3-4-5 (five-high).
 */
export function evaluatePoker(cards: readonly Card[]): PokerHand {
  const live = cards.filter((c) => c.suit !== 'joker' && VALUE[c.rank] !== undefined);
  const values = live.map((c) => VALUE[c.rank]).sort((a, b) => b - a);

  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  // Groups ordered by size, then by value: e.g. full house → [[3, K], [2, 4]].
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  const flush = live.length === 5 && live.every((c) => c.suit === live[0].suit);
  const unique = [...new Set(values)];
  let straightHigh = 0;
  if (unique.length === 5) {
    if (unique[0] - unique[4] === 4) straightHigh = unique[0];
    else if (unique.join() === '14,5,4,3,2') straightHigh = 5; // wheel
  }

  const make = (category: PokerCategory, ranks: number[]): PokerHand => ({
    category, score: [POKER_CATEGORIES.indexOf(category), ...ranks],
  });
  const byGroups = () => groups.flatMap(([v]) => [v]);

  if (straightHigh && flush) return make('straight-flush', [straightHigh]);
  if (groups[0]?.[1] === 4) return make('four-of-a-kind', byGroups());
  if (groups[0]?.[1] === 3 && groups[1]?.[1] === 2) return make('full-house', byGroups());
  if (flush) return make('flush', values);
  if (straightHigh) return make('straight', [straightHigh]);
  if (groups[0]?.[1] === 3) return make('three-of-a-kind', byGroups());
  if (groups[0]?.[1] === 2 && groups[1]?.[1] === 2) return make('two-pair', byGroups());
  if (groups[0]?.[1] === 2) return make('pair', byGroups());
  return make('high-card', values);
}

/** Negative if a < b, positive if a > b, 0 on an exact tie. */
export function comparePoker(a: PokerHand, b: PokerHand): number {
  const n = Math.max(a.score.length, b.score.length);
  for (let i = 0; i < n; i++) {
    const d = (a.score[i] ?? 0) - (b.score[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
