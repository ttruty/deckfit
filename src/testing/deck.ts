import { buildDeck, type DealOptions } from '../app/domain/models/deck-rules';
import type { Card, Deck, DeckSnapshot, Exercise } from '../app/domain/models/schemas';

/**
 * Deals a deck for a test (§9b): a deck holds pools of exercises, so anything that wants cards
 * has to deal them first, the way the launcher and the room host do.
 */
export function deal(deck: Deck, exercises: readonly Pick<Exercise, 'id' | 'difficulty' | 'equipment' | 'measure'>[], seed = 1, opts: DealOptions = {}): Card[] {
  return buildDeck(deck, new Map(exercises.map((e) => [e.id, e])), seed, opts);
}

/** The same, as the snapshot a session stores. */
export function dealtSnapshot(deck: Deck, exercises: readonly Exercise[], seed = 1, opts: DealOptions = {}): DeckSnapshot {
  return { id: deck.id, name: deck.name, suits: deck.suits, cards: deal(deck, exercises, seed, opts) };
}
