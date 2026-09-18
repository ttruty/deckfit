import type { Difficulty, Equipment, Exercise, ExerciseCategory, Measure, MuscleGroup } from '../../domain/models/schemas';

export interface ExerciseFilters {
  query: string;
  category: ExerciseCategory | null;
  /** Match if the exercise works any of these. */
  muscleGroups: MuscleGroup[];
  /** Match if the exercise uses any of these. */
  equipment: Equipment[];
  maxDifficulty: Difficulty | null;
  measure: Measure | null;
}

export const NO_FILTERS: ExerciseFilters = {
  query: '', category: null, muscleGroups: [], equipment: [], maxDifficulty: null, measure: null,
};

export function activeFilterCount(f: ExerciseFilters): number {
  return [f.query.trim() !== '', f.category, f.muscleGroups.length, f.equipment.length, f.maxDifficulty, f.measure].filter(Boolean).length;
}

/** Pure; sorted by category, then difficulty, then name. */
export function filterExercises(exercises: readonly Exercise[], f: ExerciseFilters): Exercise[] {
  const q = f.query.trim().toLowerCase();
  return exercises
    .filter((e) =>
      (!q || e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q)) &&
      (!f.category || e.category === f.category) &&
      (!f.muscleGroups.length || e.muscleGroups.some((m) => f.muscleGroups.includes(m))) &&
      (!f.equipment.length || e.equipment.some((x) => f.equipment.includes(x))) &&
      (!f.maxDifficulty || e.difficulty <= f.maxDifficulty) &&
      (!f.measure || e.measure === f.measure),
    )
    .sort((a, b) => a.category.localeCompare(b.category) || a.difficulty - b.difficulty || a.name.localeCompare(b.name));
}
