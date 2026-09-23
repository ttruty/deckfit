import type { Exercise, Session } from '../../domain/models/schemas';
import { dayDetail } from './day-detail';
import type { SessionRow } from './history-stats';

const at = (date: string, hour = 12) => new Date(`${date}T${String(hour).padStart(2, '0')}:00:00`).getTime();

function row(
  id: string,
  date: string,
  over: { hour?: number; reps?: number; seconds?: number; totals?: Record<string, number>; players?: number; inProgress?: boolean } = {},
): SessionRow {
  const { hour = 12, reps = 0, seconds = 0, totals = {}, players = 1, inProgress = false } = over;
  return {
    session: {
      id,
      startedAt: at(date, hour),
      playerId: 'me',
      game: { id: 'solo-deal', name: 'Solo Deal' },
      deck: { id: 'deck-bodyweight', name: 'Bodyweight deck', suits: [], cards: [] },
      players: Array.from({ length: players }, (_, i) => ({ id: i ? `p${i}` : 'me', name: i ? `P${i}` : 'Me' })),
      totals: { me: totals },
    } as unknown as Session,
    reps,
    seconds,
    tasks: 1,
    minutes: inProgress ? null : 12,
    inProgress,
  };
}

const exercises = new Map<string, Pick<Exercise, 'name' | 'measure'>>([
  ['ex-squat', { name: 'Air Squat', measure: 'reps' }],
  ['ex-plank', { name: 'Plank', measure: 'seconds' }],
]);

describe('dayDetail', () => {
  it('collects that day’s workouts, oldest first, and adds them up', () => {
    const rows = [
      row('a', '2026-03-17', { hour: 18, reps: 40, totals: { 'ex-squat': 40 } }),
      row('b', '2026-03-17', { hour: 8, reps: 10, seconds: 50, totals: { 'ex-squat': 10, 'ex-plank': 50 } }),
      row('c', '2026-03-16', { reps: 999 }),
    ];
    const detail = dayDetail(rows, exercises, '2026-03-17');
    expect(detail.workouts.map((w) => w.id)).toEqual(['b', 'a']);
    expect(detail).toMatchObject({ reps: 50, seconds: 50, points: 60 });
    expect(detail.workouts[0]).toMatchObject({ game: 'Solo Deal', deck: 'Bodyweight deck', minutes: 12, others: 0 });
  });

  it('lists the exercises worked, biggest first on a common scale', () => {
    const rows = [row('a', '2026-03-17', { reps: 20, seconds: 100, totals: { 'ex-squat': 20, 'ex-plank': 200 } })];
    const detail = dayDetail(rows, exercises, '2026-03-17');
    expect(detail.exercises).toEqual([
      { key: 'ex-plank', name: 'Plank', measure: 'seconds', amount: 200 }, // 200s = 40 points
      { key: 'ex-squat', name: 'Air Squat', measure: 'reps', amount: 20 },
    ]);
  });

  it('sums the same exercise across workouts', () => {
    const rows = [
      row('a', '2026-03-17', { hour: 9, totals: { 'ex-squat': 30 } }),
      row('b', '2026-03-17', { hour: 19, totals: { 'ex-squat': 25 } }),
    ];
    expect(dayDetail(rows, exercises, '2026-03-17').exercises[0]).toMatchObject({ name: 'Air Squat', amount: 55 });
  });

  it('names what an exercise key no longer resolves to', () => {
    const rows = [row('a', '2026-03-17', { totals: { wild: 10, 'bonus-cardio': 60, 'ex-gone': 5 } })];
    const named = dayDetail(rows, exercises, '2026-03-17').exercises.map((e) => [e.name, e.measure]);
    expect(named).toContainEqual(['Wild card', 'reps']);
    expect(named).toContainEqual(['Bonus cardio', 'seconds']);
    expect(named).toContainEqual(['Removed exercise', 'reps']);
  });

  it('marks a workout still in progress, and counts the others in a room game', () => {
    const rows = [row('a', '2026-03-17', { players: 3, inProgress: true })];
    expect(dayDetail(rows, exercises, '2026-03-17').workouts[0]).toMatchObject({ inProgress: true, minutes: null, others: 2 });
  });

  it('an empty day still says which day it is', () => {
    const detail = dayDetail([], exercises, '2026-03-17');
    expect(detail).toMatchObject({ day: '2026-03-17', workouts: [], reps: 0, seconds: 0, points: 0, exercises: [] });
    expect(new Date(detail.at).getDate()).toBe(17);
  });
});
