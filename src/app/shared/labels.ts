import type { Equipment, ExerciseCategory, Intensity, Measure, MuscleGroup, Suit } from '../domain/models/schemas';

/** Display labels for domain enums. Keep keys exhaustive (Record<Union, string>). */

export const CATEGORY_LABEL: Record<ExerciseCategory, string> = {
  bodyweight: 'Bodyweight', dumbbell: 'Dumbbell', kettlebell: 'Kettlebell', barbell: 'Barbell', band: 'Resistance band',
  ball: 'Exercise ball', suspension: 'Suspension', flexibility: 'Flexibility', yoga: 'Yoga', running: 'Running',
};

export const MUSCLE_LABEL: Record<MuscleGroup, string> = {
  legs: 'Legs', arms: 'Arms', chest: 'Chest', shoulders: 'Shoulders', back: 'Back', core: 'Core',
  cardio: 'Cardio', 'full-body': 'Full body', mobility: 'Mobility',
};

export const EQUIPMENT_LABEL: Record<Equipment, string> = {
  none: 'No equipment', dumbbell: 'Dumbbell', kettlebell: 'Kettlebell', barbell: 'Barbell', band: 'Band',
  ball: 'Ball', suspension: 'Suspension trainer', mat: 'Mat',
};

export const MEASURE_LABEL: Record<Measure, string> = { reps: 'Reps', seconds: 'Timed' };

/** U+FE0E forces text (not emoji) presentation so suits render as glyphs in the current color. */
export const SUIT_SYMBOL: Record<Suit, string> = {
  hearts: '♥︎', diamonds: '♦︎', clubs: '♣︎', spades: '♠︎', joker: '★︎',
};
export const SUIT_NAME: Record<Suit, string> = { hearts: 'Hearts', diamonds: 'Diamonds', clubs: 'Clubs', spades: 'Spades', joker: 'Joker' };

export const DIFFICULTY_LABEL = ['', 'Easy', 'Moderate', 'Challenging', 'Hard', 'Expert'] as const;

/** Intensity as people read it; the numbers behind it live in engine/amounts (INTENSITY_FACTOR). */
export const INTENSITY_LABEL: Record<Intensity, string> = { low: 'Low', moderate: 'Moderate', high: 'High' };
export const INTENSITY_HELP: Record<Intensity, string> = {
  low: 'Easier: about 30% fewer reps and shorter holds',
  moderate: 'The card says what it says',
  high: 'Harder: about 40% more reps and longer holds',
};

export const keysOf = <K extends string>(record: Record<K, string>) => Object.keys(record) as K[];
