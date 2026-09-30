import type { Session } from '../models/schemas';
import type { SessionExercise, SessionRow } from './history-stats';
import { GROUP_SUITS, periodTotals, suitLabels } from './period';

const at = (date: string, hour = 12) => new Date(`${date}T${String(hour).padStart(2, '0')}:00:00`).getTime();
const TODAY = at('2026-03-18'); // Wednesday

function row(
  date: string,
  over: {
    reps?: number;
    seconds?: number;
    minutes?: number | null;
    exercises?: SessionExercise[];
    groups?: { suit: SessionRow['groups'][number]['suit']; label: string; reps: number; seconds: number }[];
  } = {},
): SessionRow {
  const { reps = 0, seconds = 0, minutes = 10, exercises = [], groups = [] } = over;
  return {
    session: { id: date + reps, startedAt: at(date) } as unknown as Session,
    reps,
    seconds,
    tasks: 1,
    minutes,
    inProgress: minutes === null,
    exercises,
    groups,
  };
}

const squat: SessionExercise = { key: 'ex-squat', name: 'Air Squat', measure: 'reps', amount: 20, suit: 'hearts' };
const plank: SessionExercise = { key: 'ex-plank', name: 'Plank', measure: 'seconds', amount: 200, suit: 'spades' };

describe('periodTotals', () => {
  const rows = [
    row('2026-03-18', { reps: 30, minutes: 5, exercises: [{ ...squat, amount: 30 }], groups: [{ suit: 'hearts', label: 'Legs', reps: 30, seconds: 0 }] }),
    row('2026-03-14', { reps: 40, seconds: 60, minutes: 12, exercises: [{ ...squat, amount: 40 }, { ...plank, amount: 60 }], groups: [{ suit: 'hearts', label: 'Legs', reps: 40, seconds: 0 }, { suit: 'spades', label: 'Core', reps: 0, seconds: 60 }] }),
    row('2026-03-01', { reps: 100, minutes: 20, exercises: [{ ...squat, amount: 100 }], groups: [{ suit: 'hearts', label: 'Legs', reps: 100, seconds: 0 }] }),
    row('2025-12-20', { reps: 500, minutes: 60, exercises: [{ ...squat, amount: 500 }], groups: [{ suit: 'hearts', label: 'Legs', reps: 500, seconds: 0 }] }),
  ];

  it('counts only the window asked for', () => {
    expect(periodTotals(rows, TODAY, 'week')).toMatchObject({ workouts: 2, reps: 70, seconds: 60, minutes: 17 });
    expect(periodTotals(rows, TODAY, 'month')).toMatchObject({ workouts: 3, reps: 170, minutes: 37 });
    expect(periodTotals(rows, TODAY, '26w')).toMatchObject({ workouts: 4, reps: 670, minutes: 97 });
  });

  it('starts the week seven days back, today included', () => {
    expect(periodTotals(rows, TODAY, 'week').from).toBe('2026-03-12');
    expect(periodTotals(rows, TODAY, 'month').from).toBe('2026-02-17');
  });

  it('always shows the four groups, in suit order, zeros included', () => {
    const { groups } = periodTotals(rows, TODAY, 'week');
    expect(groups.map((g) => g.suit)).toEqual(GROUP_SUITS);
    expect(groups.map((g) => [g.label, g.reps, g.seconds])).toEqual([
      ['Legs', 70, 0],
      ['Push', 0, 0],
      ['Pull', 0, 0],
      ['Core', 0, 60],
    ]);
  });

  it('ranks exercises on a common scale and counts the workouts each was in', () => {
    const { exercises } = periodTotals(rows, TODAY, 'week');
    expect(exercises.map((e) => [e.name, e.amount, e.sessions])).toEqual([
      ['Air Squat', 70, 2],
      ['Plank', 60, 1], // 60s = 12 points, behind 70 reps
    ]);
    expect(exercises[1]).toMatchObject({ measure: 'seconds', suit: 'spades' });
  });

  it('an empty window still reads as zeros, not as nothing', () => {
    const totals = periodTotals([], TODAY, 'week');
    expect(totals).toMatchObject({ workouts: 0, reps: 0, seconds: 0, minutes: 0, exercises: [] });
    expect(totals.groups.map((g) => g.label)).toEqual(['Legs', 'Push', 'Pull', 'Core']);
  });

  it('a workout still running adds no time', () => {
    const open = [row('2026-03-18', { reps: 10, minutes: null })];
    expect(periodTotals(open, TODAY, 'week')).toMatchObject({ workouts: 1, reps: 10, minutes: 0 });
  });
});

describe('suitLabels', () => {
  it('uses the names this player has been dealt most often', () => {
    const rows = [
      row('2026-03-18', { groups: [{ suit: 'clubs', label: 'Spine', reps: 10, seconds: 0 }] }),
      row('2026-03-17', { groups: [{ suit: 'clubs', label: 'Spine', reps: 10, seconds: 0 }] }),
      row('2026-03-16', { groups: [{ suit: 'clubs', label: 'Pull', reps: 10, seconds: 0 }] }),
    ];
    expect(suitLabels(rows)['clubs']).toBe('Spine');
  });

  it('falls back to the strength names for a suit never dealt', () => {
    expect(suitLabels([])).toMatchObject({ hearts: 'Legs', diamonds: 'Push', clubs: 'Pull', spades: 'Core' });
  });
});
