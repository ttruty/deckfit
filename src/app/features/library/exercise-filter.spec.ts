import type { Exercise } from '../../domain/models/schemas';
import { NO_FILTERS, activeFilterCount, filterExercises } from './exercise-filter';

const ex = (over: Partial<Exercise>): Exercise => ({
  id: 'x', name: 'X', description: '', category: 'bodyweight', muscleGroups: ['legs'], equipment: ['none'],
  difficulty: 1, measure: 'reps', figure: { start: 'stand', end: 'squat', prop: null }, builtIn: true, ...over,
});

const all = [
  ex({ id: 'squat', name: 'Air Squat', description: 'Sit back and down' }),
  ex({ id: 'plank', name: 'Plank', muscleGroups: ['core'], difficulty: 2, measure: 'seconds' }),
  ex({ id: 'swing', name: 'Swing', category: 'kettlebell', equipment: ['kettlebell'], muscleGroups: ['legs', 'back'], difficulty: 3 }),
  ex({ id: 'pose', name: 'Tree Pose', category: 'yoga', equipment: ['mat'], muscleGroups: ['mobility'], difficulty: 2, measure: 'seconds' }),
];
const ids = (f: Partial<typeof NO_FILTERS>) => filterExercises(all, { ...NO_FILTERS, ...f }).map((e) => e.id);

describe('filterExercises', () => {
  it('returns everything sorted by category, difficulty, name when unfiltered', () => {
    expect(ids({})).toEqual(['squat', 'plank', 'swing', 'pose']);
  });

  it('searches name and description, case-insensitively', () => {
    expect(ids({ query: 'SQUAT' })).toEqual(['squat']);
    expect(ids({ query: 'sit back' })).toEqual(['squat']);
    expect(ids({ query: '  ' })).toHaveLength(4);
  });

  it('filters by category and measure', () => {
    expect(ids({ category: 'yoga' })).toEqual(['pose']);
    expect(ids({ measure: 'seconds' })).toEqual(['plank', 'pose']);
  });

  it('matches any selected muscle group or equipment', () => {
    expect(ids({ muscleGroups: ['back', 'core'] })).toEqual(['plank', 'swing']);
    expect(ids({ equipment: ['mat', 'kettlebell'] })).toEqual(['swing', 'pose']);
  });

  it('caps difficulty inclusively', () => {
    expect(ids({ maxDifficulty: 2 })).toEqual(['squat', 'plank', 'pose']);
  });

  it('combines filters with AND', () => {
    expect(ids({ muscleGroups: ['legs'], maxDifficulty: 1 })).toEqual(['squat']);
    expect(ids({ category: 'yoga', measure: 'reps' })).toEqual([]);
  });

  it('counts active filters', () => {
    expect(activeFilterCount(NO_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...NO_FILTERS, query: 'a', muscleGroups: ['legs'], maxDifficulty: 3 })).toBe(3);
  });
});
