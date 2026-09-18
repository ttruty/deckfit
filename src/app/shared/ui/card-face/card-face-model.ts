import type { Card, Deck, Exercise } from '../../../domain/models/schemas';
import type { CardFaceModel } from './card-face.component';

/** Builds the presentational model for one card of a deck. `amount` defaults to the card's baseAmount. */
export function toCardFaceModel(
  card: Card,
  deck: Pick<Deck, 'suits'>,
  exercisesById: ReadonlyMap<string, Pick<Exercise, 'name' | 'measure' | 'figure'>>,
  amount = card.baseAmount,
): CardFaceModel {
  const ex = card.exerciseId ? exercisesById.get(card.exerciseId) : undefined;
  return {
    suit: card.suit,
    rank: card.rank,
    suitLabel: deck.suits.find((s) => s.suit === card.suit)?.label ?? '',
    amount,
    exercise: ex ? { name: ex.name, measure: ex.measure, figure: ex.figure } : null,
  };
}
