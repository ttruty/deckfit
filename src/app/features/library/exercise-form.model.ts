import { newId } from '../../core/db/deckfit-db';
import type { BandAnchor, Difficulty, Equipment, Exercise, ExerciseCategory, Measure, MuscleGroup, Prop } from '../../domain/models/schemas';

/** Prop kinds as the form offers them ('none' means no prop). */
export const PROP_TYPES = ['none', 'dumbbell', 'kettlebell', 'barbell', 'band', 'ball', 'strap'] as const;
export type PropType = (typeof PROP_TYPES)[number];

export const PROP_LABEL: Record<PropType, string> = {
  none: 'No equipment shown', dumbbell: 'Dumbbell', kettlebell: 'Kettlebell', barbell: 'Barbell',
  band: 'Resistance band', ball: 'Exercise ball', strap: 'Suspension straps',
};

/** What each prop implies for the exercise's equipment list, so the two can't disagree. */
export const PROP_EQUIPMENT: Record<PropType, Equipment | null> = {
  none: null, dumbbell: 'dumbbell', kettlebell: 'kettlebell', barbell: 'barbell', band: 'band', ball: 'ball', strap: 'suspension',
};

export interface PropFormValue {
  type: PropType;
  /** band */
  anchor: BandAnchor;
  /** ball */
  x: number;
  y: number;
  r: number;
  /** strap */
  attach: 'hands' | 'feet';
  anchorX: number | null;
}

export interface ExerciseFormValue {
  name: string;
  description: string;
  cues: string[];
  category: ExerciseCategory;
  muscleGroups: MuscleGroup[];
  equipment: Equipment[];
  difficulty: Difficulty;
  measure: Measure;
  start: string;
  end: string;
  prop: PropFormValue;
  seated: boolean;
  lowImpact: boolean;
  notes: string;
}

export const DEFAULT_PROP: PropFormValue = { type: 'none', anchor: 'feet', x: 50, y: 60, r: 10, attach: 'hands', anchorX: 50 };

export function blankExerciseForm(): ExerciseFormValue {
  return {
    name: '', description: '', cues: [], category: 'bodyweight', muscleGroups: [], equipment: ['none'],
    difficulty: 2, measure: 'reps', start: 'stand', end: 'squat', prop: { ...DEFAULT_PROP },
    seated: false, lowImpact: false, notes: '',
  };
}

/** Editor state for an existing exercise (a copy keeps everything but the id). */
export function toFormValue(ex: Exercise): ExerciseFormValue {
  return {
    name: ex.name,
    description: ex.description,
    cues: [...(ex.cues ?? [])],
    category: ex.category,
    muscleGroups: [...ex.muscleGroups],
    equipment: [...ex.equipment],
    difficulty: ex.difficulty,
    measure: ex.measure,
    start: ex.figure.start,
    end: ex.figure.end,
    prop: toPropForm(ex.figure.prop),
    seated: ex.adaptive?.seated ?? false,
    lowImpact: ex.adaptive?.lowImpact ?? false,
    notes: ex.adaptive?.notes ?? '',
  };
}

export function toPropForm(prop: Prop): PropFormValue {
  if (!prop) return { ...DEFAULT_PROP };
  switch (prop.type) {
    case 'band': return { ...DEFAULT_PROP, type: 'band', anchor: prop.anchor };
    case 'ball': return { ...DEFAULT_PROP, type: 'ball', x: prop.x, y: prop.y, r: prop.r };
    case 'strap': return { ...DEFAULT_PROP, type: 'strap', attach: prop.attach, anchorX: prop.anchorX ?? null };
    default: return { ...DEFAULT_PROP, type: prop.type };
  }
}

/** The drawn prop, or null. Only the fields that kind uses are kept. */
export function toProp(value: PropFormValue): Prop {
  switch (value.type) {
    case 'none': return null;
    case 'band': return { type: 'band', anchor: value.anchor };
    case 'ball': return { type: 'ball', x: value.x, y: value.y, r: value.r };
    case 'strap': return { type: 'strap', attach: value.attach, ...(value.anchorX === null ? {} : { anchorX: value.anchorX }) };
    default: return { type: value.type };
  }
}

/**
 * Form value → Exercise (validated by ExerciseSchema on save). Blank cues and notes are dropped,
 * and the prop's equipment is always included so a dumbbell figure can't claim "no equipment".
 */
export function toExercise(value: ExerciseFormValue, id = newId('exercise')): Exercise {
  const cues = value.cues.map((c) => c.trim()).filter(Boolean);
  const notes = value.notes.trim();
  const adaptive = { ...(value.seated ? { seated: true } : {}), ...(value.lowImpact ? { lowImpact: true } : {}), ...(notes ? { notes } : {}) };
  return {
    id,
    name: value.name.trim(),
    description: value.description.trim(),
    ...(cues.length ? { cues } : {}),
    category: value.category,
    muscleGroups: [...value.muscleGroups],
    equipment: withPropEquipment(value.equipment, value.prop.type),
    difficulty: value.difficulty,
    measure: value.measure,
    figure: { start: value.start, end: value.end, prop: toProp(value.prop) },
    ...(Object.keys(adaptive).length ? { adaptive } : {}),
    builtIn: false,
  };
}

/** Keeps the equipment list consistent with the drawn prop: adds it, and drops 'none' when there is one. */
export function withPropEquipment(equipment: readonly Equipment[], prop: PropType): Equipment[] {
  const needed = PROP_EQUIPMENT[prop];
  if (!needed) return equipment.length ? [...equipment] : ['none'];
  const list: Equipment[] = equipment.filter((e) => e !== 'none');
  if (!list.includes(needed)) list.push(needed);
  return list;
}

/** "ball-crunch-start" → "Ball crunch start"; poses are grouped by their first word. */
export function poseLabel(id: string): string {
  const words = id.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function poseGroup(id: string): string {
  return poseLabel(id.split('-')[0]);
}

/** Pose ids that match a search over the id and its label. */
export function searchPoses(ids: readonly string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  return q ? ids.filter((id) => id.toLowerCase().includes(q) || poseLabel(id).toLowerCase().includes(q)) : [...ids];
}
