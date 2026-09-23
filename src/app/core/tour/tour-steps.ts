import type { Suit } from '../../domain/models/schemas';

export interface TourStep {
  /** Short headline, sentence case. */
  title: string;
  /** One or two plain sentences — no engine words (§6.3 howTo has the same rule). */
  body: string;
  /** Material icon for the badge. */
  icon: string;
  /** Suit the badge borrows its colour from, so the guide looks like the cards. */
  suit: Suit;
}

/**
 * The first-run guide (§12a). Five steps, in the order someone meets the app: what a card asks
 * of you, where the exercises and rules come from, the fastest way to start, playing together,
 * and making your own. Keep it short — it is a welcome, not a manual.
 */
export const TOUR_STEPS: readonly TourStep[] = [
  {
    title: 'Every card is an exercise',
    body: 'A card names the exercise and how much of it: the number on the card is your reps, or seconds for a hold. Do it, then turn the next one.',
    icon: 'style',
    suit: 'hearts',
  },
  {
    title: 'A deck and a game',
    body: 'The deck decides which exercises you get. The game decides the rules — flip one at a time, race a friend, or bluff your way out of the work.',
    icon: 'casino',
    suit: 'diamonds',
  },
  {
    title: 'Start in one tap',
    body: 'Quick Start on the home screen deals a bodyweight workout straight away. Set the intensity to low, moderate or high and the numbers follow.',
    icon: 'play_circle',
    suit: 'clubs',
  },
  {
    title: 'Play with friends',
    body: 'Start a room and share the code or QR. Everyone plays on their own phone, and the table shows who is working and who won the round.',
    icon: 'group',
    suit: 'spades',
  },
  {
    title: 'Make it yours',
    body: 'Save a routine to start it with one tap, build your own decks, exercises and games, and see what you have done in History.',
    icon: 'auto_awesome',
    suit: 'joker',
  },
];
