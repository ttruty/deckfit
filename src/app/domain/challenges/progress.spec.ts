import type { ChallengeDay } from '../models/challenge.schema';
import { dailyWork, dayKey, daysToUpload, debtRemaining, sessionWork, type WorkSession } from './progress';

const at = (date: string, hour = 12) => new Date(`${date}T${String(hour).padStart(2, '0')}:00:00`).getTime();
const session = (date: string, reps: number, seconds = 0, hour = 12): WorkSession => ({ startedAt: at(date, hour), reps, seconds });

const window = { startsOn: '2026-03-16', endsOn: '2026-03-20' };

describe('dailyWork', () => {
  it('adds up a day: reps as they are, 5 seconds to the point', () => {
    const work = dailyWork([session('2026-03-16', 30), session('2026-03-16', 0, 50), session('2026-03-17', 10)]);
    expect(work.get('2026-03-16')).toEqual({ points: 40, workouts: 2 });
    expect(work.get('2026-03-17')).toEqual({ points: 10, workouts: 1 });
  });

  it('counts a late-night workout on the day it started', () => {
    expect([...dailyWork([session('2026-03-17', 10, 0, 23)]).keys()]).toEqual(['2026-03-17']);
    expect(dayKey(at('2026-03-17', 23))).toBe('2026-03-17');
  });
});

describe('daysToUpload', () => {
  const work = dailyWork([session('2026-03-16', 30), session('2026-03-18', 40)]);

  it('sends this player’s days inside the challenge window', () => {
    expect(daysToUpload(window, 'ann', work, [])).toEqual([
      { playerId: 'ann', day: '2026-03-16', points: 30, workouts: 1 },
      { playerId: 'ann', day: '2026-03-18', points: 40, workouts: 1 },
    ]);
  });

  it('leaves out days outside it', () => {
    const wide = dailyWork([session('2026-03-15', 10), session('2026-03-16', 10), session('2026-03-21', 10)]);
    expect(daysToUpload(window, 'ann', wide, []).map((d) => d.day)).toEqual(['2026-03-16']);
  });

  it('sends nothing when the stored numbers already match', () => {
    const known: ChallengeDay[] = [
      { playerId: 'ann', day: '2026-03-16', points: 30, workouts: 1 },
      { playerId: 'ann', day: '2026-03-18', points: 40, workouts: 1 },
    ];
    expect(daysToUpload(window, 'ann', work, known)).toEqual([]);
  });

  it('sends a day again when it has grown', () => {
    const known: ChallengeDay[] = [{ playerId: 'ann', day: '2026-03-16', points: 10, workouts: 1 }];
    expect(daysToUpload(window, 'ann', work, known).map((d) => d.day)).toEqual(['2026-03-16', '2026-03-18']);
  });

  it('never writes another player’s row', () => {
    const known: ChallengeDay[] = [{ playerId: 'bo', day: '2026-03-16', points: 999, workouts: 9 }];
    expect(daysToUpload(window, 'ann', work, known).every((d) => d.playerId === 'ann')).toBe(true);
  });
});

describe('debtRemaining', () => {
  it('pays down with work done after the challenge ended', () => {
    const work = dailyWork([session('2026-03-21', 60), session('2026-03-22', 30)]);
    expect(debtRemaining(200, '2026-03-20', work)).toBe(110);
  });

  it('ignores work done during the challenge', () => {
    expect(debtRemaining(200, '2026-03-20', dailyWork([session('2026-03-19', 500)]))).toBe(200);
  });

  it('never goes below zero', () => {
    expect(debtRemaining(50, '2026-03-20', dailyWork([session('2026-03-21', 400)]))).toBe(0);
  });
});

describe('sessionWork', () => {
  const session = (log: unknown[]) =>
    ({
      id: 's', seed: 1, startedAt: at('2026-03-16'), playerId: 'me',
      game: { id: 'solo-deal', name: 'Solo Deal' },
      deck: { id: 'd', name: 'Deck', suits: [], cards: [] },
      settings: { repMultiplier: 1, faceCardValue: 10, aceValue: 11, jokerRule: 'rest', players: { min: 1, max: 1 } },
      players: [{ id: 'me', name: 'Me' }], log, totals: {},
    }) as unknown as Parameters<typeof sessionWork>[0];

  const assigned = (id: string, playerId: string, measure: 'reps' | 'seconds', kind = 'exercise') => ({
    type: 'TaskAssigned',
    task: { id, playerId, kind, exerciseId: kind === 'exercise' ? 'ex' : null, cardIds: ['c1'], amount: 10, measure, status: 'pending' },
  });
  const completed = (taskId: string, playerId: string, amount: number) => ({ type: 'TaskCompleted', taskId, playerId, amount, exerciseKey: 'ex' });

  it('counts what this player actually logged, in the right unit', () => {
    const work = sessionWork(session([
      assigned('t1', 'me', 'reps'), completed('t1', 'me', 12),
      assigned('t2', 'me', 'seconds'), completed('t2', 'me', 45),
    ]));
    expect(work).toMatchObject({ reps: 12, seconds: 45 });
  });

  it('ignores rest, other players, and anything unfinished or unreadable', () => {
    const work = sessionWork(session([
      assigned('t1', 'me', 'seconds', 'rest'), completed('t1', 'me', 30),
      assigned('t2', 'bo', 'reps'), completed('t2', 'bo', 99),
      assigned('t3', 'me', 'reps'), // never completed
      { type: 'NotAnEvent' },
    ]));
    expect(work).toMatchObject({ reps: 0, seconds: 0 });
  });
});
