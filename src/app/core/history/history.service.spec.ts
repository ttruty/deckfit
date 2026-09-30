import { TestBed } from '@angular/core/testing';
import { provideTestDb } from '../../../testing/db';
import { provideFakeClock } from '../../../testing/fake-clock';
import type { Session } from '../../domain/models/schemas';
import { SessionRepository } from '../db/repositories';
import { HistoryService } from './history.service';

const at = (date: string, hour = 12) => new Date(`${date}T${String(hour).padStart(2, '0')}:00:00`).getTime();
const TODAY = at('2026-03-18');

/** A finished solo workout worth `reps` on that day. */
function workout(id: string, date: string, reps: number): Session {
  const task = { id: 't1', playerId: 'me', kind: 'exercise', exerciseId: 'ex-squat', cardIds: ['c1'], amount: reps, measure: 'reps', status: 'done' };
  return {
    id,
    seed: 1,
    startedAt: at(date),
    endedAt: at(date) + 600_000,
    outcome: 'finished',
    playerId: 'me',
    game: { id: 'solo-deal', name: 'Solo Deal' },
    deck: { id: 'deck-bodyweight', name: 'Bodyweight deck', suits: [], cards: [] },
    settings: { repMultiplier: 1, faceCardValue: 10, aceValue: 11, jokerRule: 'rest', players: { min: 1, max: 1 } },
    players: [{ id: 'me', name: 'Me' }],
    log: [
      { type: 'TaskAssigned', task },
      { type: 'TaskCompleted', taskId: 't1', playerId: 'me', amount: reps, exerciseKey: 'ex-squat' },
    ],
    totals: { me: { 'ex-squat': reps } },
  } as unknown as Session;
}

describe('HistoryService', () => {
  beforeEach(() => {
    provideTestDb();
    provideFakeClock(TODAY);
  });

  const service = () => TestBed.inject(HistoryService);
  const sessions = () => TestBed.inject(SessionRepository);

  it('loads the rows, the totals and the calendar together', async () => {
    await sessions().save(workout('a', '2026-03-18', 20));
    await sessions().save(workout('b', '2026-03-17', 30));

    const snapshot = await service().load();
    expect(snapshot.stats.workouts).toBe(2);
    expect(snapshot.stats.reps).toBe(50);
    expect(snapshot.grid.currentStreak).toBe(2);
    expect(snapshot.grid.days).toBe(182);
  });

  it('the headline counts the last seven days, not everything', async () => {
    await sessions().save(workout('a', '2026-03-18', 20)); // today
    await sessions().save(workout('b', '2026-03-12', 30)); // seven days back, inside the week
    await sessions().save(workout('c', '2026-03-01', 999)); // older, outside it

    expect(await service().headline()).toEqual({ streak: 1, repsThisWeek: 50, workouts: 3 });
  });

  it('says nothing has been done yet on a fresh device', async () => {
    expect(await service().headline()).toEqual({ streak: 0, repsThisWeek: 0, workouts: 0 });
  });
});
