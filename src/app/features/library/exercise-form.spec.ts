import { blankExerciseForm, toExercise, toFormValue, toProp, toPropForm, withPropEquipment, poseGroup, poseLabel, searchPoses } from './exercise-form.model';
import { ExerciseSchema } from '../../domain/models/schemas';

describe('exercise form model', () => {
  it('builds a valid Exercise from a filled-in form, dropping blanks', () => {
    const value = {
      ...blankExerciseForm(),
      name: '  Wall Angel  ', description: ' Slide arms up a wall. ', cues: ['Ribs down', '  ', ''],
      muscleGroups: ['back' as const], difficulty: 3 as const, measure: 'seconds' as const,
      start: 'stand', end: 'prone-angel', notes: '  ', seated: true,
    };
    const ex = toExercise(value, 'exercise-1');
    expect(ExerciseSchema.parse(ex)).toEqual(ex);
    expect(ex).toMatchObject({
      id: 'exercise-1', name: 'Wall Angel', description: 'Slide arms up a wall.', cues: ['Ribs down'],
      equipment: ['none'], figure: { start: 'stand', end: 'prone-angel', prop: null }, adaptive: { seated: true }, builtIn: false,
    });
    expect('notes' in ex.adaptive!).toBe(false);
  });

  it('keeps the drawn prop and the equipment list in step', () => {
    const value = { ...blankExerciseForm(), name: 'Row', muscleGroups: ['back' as const], prop: { ...blankExerciseForm().prop, type: 'dumbbell' as const } };
    expect(toExercise(value).equipment).toEqual(['dumbbell']);
    expect(withPropEquipment(['mat'], 'band')).toEqual(['mat', 'band']);
    expect(withPropEquipment(['none'], 'none')).toEqual(['none']);
    expect(withPropEquipment([], 'none')).toEqual(['none']);
    expect(withPropEquipment(['ball'], 'ball')).toEqual(['ball']);
  });

  it('round-trips every prop kind through the form', () => {
    for (const prop of [
      null, { type: 'kettlebell' as const }, { type: 'band' as const, anchor: 'knees' as const },
      { type: 'ball' as const, x: 40, y: 70, r: 12 }, { type: 'strap' as const, attach: 'feet' as const, anchorX: 30 },
      { type: 'strap' as const, attach: 'hands' as const },
    ]) {
      expect(toProp(toPropForm(prop))).toEqual(prop);
    }
  });

  it('round-trips an exercise through the form', () => {
    const ex = ExerciseSchema.parse({
      id: 'e1', name: 'Band pull-apart', description: 'Pull the band apart.', cues: ['Squeeze'], category: 'band',
      muscleGroups: ['back', 'shoulders'], equipment: ['band'], difficulty: 2, measure: 'reps',
      figure: { start: 'stand-front', end: 'prone-y', prop: { type: 'band', anchor: 'front' } },
      adaptive: { seated: true, notes: 'Sit tall' }, builtIn: false,
    });
    expect(toExercise(toFormValue(ex), ex.id)).toEqual(ex);
  });

  it('labels, groups and searches poses', () => {
    expect(poseLabel('ball-crunch-start')).toBe('Ball crunch start');
    expect(poseGroup('ball-crunch-start')).toBe('Ball');
    expect(searchPoses(['stand', 'squat-bar', 'ball-y'], 'bar')).toEqual(['squat-bar']);
    expect(searchPoses(['stand', 'squat-bar'], ' ')).toEqual(['stand', 'squat-bar']);
  });
});
