import type { Card, GameSettings, Measure } from '../models/schemas';
import type { TaskKind } from './state';

/** Timed exercises use 5 seconds per card point (§9b). */
export const SECONDS_PER_POINT = 5;
/** jokerRule 'rest': seconds of rest per joker; never multiplied or capped. */
export const REST_SECONDS_PER_JOKER = 30;
/** jokerRule 'bonus-cardio': seconds of cardio per joker, before multiplier and cap. */
export const BONUS_CARDIO_SECONDS_PER_JOKER = 60;

export interface AmountSource {
  settings: Pick<GameSettings, 'repMultiplier' | 'faceCardValue' | 'aceValue' | 'jokerRule' | 'maxRepCap'>;
  measureOf(exerciseId: string): Measure | undefined;
}

export interface TaskDraft {
  cardIds: string[];
  kind: TaskKind;
  exerciseId: string | null;
  amount: number;
  measure: Measure;
}

/**
 * Pre-multiplier amount of one non-joker card, in its exercise's unit.
 * Number cards use baseAmount (already ×5 for timed exercises, and editable per deck);
 * J/Q/K and A use the faceCardValue / aceValue settings, ×5 when timed.
 */
export function cardAmount(card: Card, measure: Measure, settings: AmountSource['settings']): number {
  const unit = measure === 'seconds' ? SECONDS_PER_POINT : 1;
  switch (card.rank) {
    case 'J':
    case 'Q':
    case 'K':
      return settings.faceCardValue * unit;
    case 'A':
      return settings.aceValue * unit;
    case 'JOKER':
      throw new Error(`cardAmount: ${card.id} is a joker`);
    default:
      return card.baseAmount;
  }
}

/** × repMultiplier, round half up, then cap (maxRepCap reps, or maxRepCap × 5 seconds). */
export function scaleAmount(raw: number, measure: Measure, settings: AmountSource['settings']): number {
  const scaled = Math.round(raw * settings.repMultiplier);
  if (settings.maxRepCap === undefined) return scaled;
  const cap = settings.maxRepCap * (measure === 'seconds' ? SECONDS_PER_POINT : 1);
  return Math.min(scaled, cap);
}

/**
 * Turns assigned cards into tasks: one per exercise (amounts summed) and one per joker
 * kind, in order of first appearance. Zero-amount tasks are dropped.
 */
export function planTasks(cards: readonly Card[], src: AmountSource): TaskDraft[] {
  const { settings } = src;
  const groups = new Map<string, TaskDraft & { raw: number }>();

  for (const card of cards) {
    if (card.exerciseId === null) {
      const rule = settings.jokerRule;
      if (rule === 'skip') continue;
      const g = groups.get(`joker:${rule}`) ?? {
        cardIds: [], kind: rule, exerciseId: null, amount: 0, raw: 0,
        measure: rule === 'wild' ? 'reps' : 'seconds',
      };
      g.cardIds.push(card.id);
      g.raw += rule === 'rest' ? REST_SECONDS_PER_JOKER : rule === 'wild' ? settings.faceCardValue : BONUS_CARDIO_SECONDS_PER_JOKER;
      groups.set(`joker:${rule}`, g);
      continue;
    }
    const measure = src.measureOf(card.exerciseId);
    if (!measure) throw new Error(`planTasks: unknown exercise ${card.exerciseId} on ${card.id}`);
    const g = groups.get(card.exerciseId) ?? {
      cardIds: [], kind: 'exercise' as const, exerciseId: card.exerciseId, amount: 0, raw: 0, measure,
    };
    g.cardIds.push(card.id);
    g.raw += cardAmount(card, measure, settings);
    groups.set(card.exerciseId, g);
  }

  return [...groups.values()]
    .map(({ raw, ...draft }) => ({
      ...draft,
      amount: draft.kind === 'rest' ? raw : scaleAmount(raw, draft.measure, settings),
    }))
    .filter((d) => d.amount > 0);
}
