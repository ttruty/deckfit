import type { Challenge, ChallengeDay, ChallengeGoal, ChallengeState } from '../models/challenge.schema';
import { challengeDays, challengeStandings, ownStatus } from './standings';

const challenge = (goal: ChallengeGoal, over: Partial<Challenge> = {}): Challenge => ({
  id: 'c1',
  code: 'ABC123',
  name: 'Week of pain',
  goal,
  ante: 20,
  startsOn: '2026-03-16',
  endsOn: '2026-03-20', // Mon–Fri
  createdBy: 'ann',
  createdAt: 0,
  ...over,
});

const day = (playerId: string, d: string, points: number, workouts = 1): ChallengeDay => ({ playerId, day: d, points, workouts });

const state = (goal: ChallengeGoal, days: ChallengeDay[], over: Partial<Challenge> = {}): ChallengeState => ({
  challenge: challenge(goal, over),
  members: [
    { playerId: 'ann', name: 'Ann', joinedAt: 0 },
    { playerId: 'bo', name: 'Bo', joinedAt: 0 },
  ],
  days,
});

const standing = (s: ReturnType<typeof challengeStandings>, id: string) => s.players.find((p) => p.playerId === id)!;

describe('challengeDays', () => {
  it('lists every day, inclusive', () => {
    expect(challengeDays({ startsOn: '2026-03-16', endsOn: '2026-03-20' })).toEqual([
      '2026-03-16', '2026-03-17', '2026-03-18', '2026-03-19', '2026-03-20',
    ]);
    expect(challengeDays({ startsOn: '2026-03-16', endsOn: '2026-03-16' })).toEqual(['2026-03-16']);
  });

  it('crosses a month end', () => {
    expect(challengeDays({ startsOn: '2026-02-27', endsOn: '2026-03-02' })).toEqual([
      '2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02',
    ]);
  });
});

describe('challengeStandings — a streak challenge', () => {
  const goal = { kind: 'streak' } as const;

  it('today is still open: nothing is staked until the day is over', () => {
    const s = challengeStandings(state(goal, [day('ann', '2026-03-16', 50)]), '2026-03-17');
    expect(s.daysGone).toBe(1);
    expect(standing(s, 'ann')).toMatchObject({ made: 1, missed: 0, staked: 0, clean: true });
    expect(standing(s, 'bo')).toMatchObject({ made: 0, missed: 1, staked: 20 });
    expect(s.pot).toBe(20);
    expect(s.over).toBe(false);
  });

  it('marks each day made, missed or still open', () => {
    const s = challengeStandings(state(goal, [day('ann', '2026-03-16', 10), day('ann', '2026-03-18', 10)]), '2026-03-18');
    expect(s.grid['ann']).toEqual(['made', 'missed', 'made', 'open', 'open']);
    expect(s.grid['bo']).toEqual(['missed', 'missed', 'open', 'open', 'open']);
    expect(standing(s, 'ann').todayDone).toBe(true);
    expect(standing(s, 'bo').todayDone).toBe(false);
  });

  it('a day with any workout counts, however small', () => {
    const s = challengeStandings(state(goal, [day('ann', '2026-03-16', 1)]), '2026-03-17');
    expect(standing(s, 'ann').made).toBe(1);
  });

  it('when it ends, the missers split the pot and the clean walk away', () => {
    const days = ['2026-03-16', '2026-03-17', '2026-03-18', '2026-03-19', '2026-03-20'].map((d) => day('ann', d, 30));
    const s = challengeStandings(state(goal, [...days, day('bo', '2026-03-16', 30)]), '2026-03-21');
    expect(s.over).toBe(true);
    expect(standing(s, 'ann')).toMatchObject({ made: 5, missed: 0, staked: 0, owed: 0, clean: true });
    expect(standing(s, 'bo')).toMatchObject({ missed: 4, staked: 80, owed: 80 }); // the only misser works the lot
    expect(s.pot).toBe(80);
  });

  it('two missers share the pot evenly', () => {
    const s = challengeStandings(state({ kind: 'streak' }, [day('ann', '2026-03-16', 30), day('bo', '2026-03-17', 30)]), '2026-03-21');
    expect(s.pot).toBe(160); // 4 missed days each × 20
    for (const id of ['ann', 'bo']) expect(standing(s, id).owed).toBe(80);
  });

  it('nobody misses, nobody owes', () => {
    const all = ['2026-03-16', '2026-03-17', '2026-03-18', '2026-03-19', '2026-03-20'];
    const days = all.flatMap((d) => [day('ann', d, 10), day('bo', d, 10)]);
    const s = challengeStandings(state({ kind: 'streak' }, days), '2026-03-21');
    expect(s.pot).toBe(0);
    expect(s.players.every((p) => p.owed === 0 && p.clean)).toBe(true);
  });
});

describe('challengeStandings — a daily target', () => {
  const goal = { kind: 'daily', points: 100 } as const;

  it('needs the target, not just a workout', () => {
    const s = challengeStandings(state(goal, [day('ann', '2026-03-16', 100), day('bo', '2026-03-16', 99)]), '2026-03-17');
    expect(standing(s, 'ann')).toMatchObject({ made: 1, missed: 0 });
    expect(standing(s, 'bo')).toMatchObject({ made: 0, missed: 1, staked: 20, points: 99 });
  });
});

describe('challengeStandings — a total by the deadline', () => {
  const goal = { kind: 'total', points: 500 } as const;

  it('stakes nothing while it runs, however uneven the days', () => {
    const s = challengeStandings(state(goal, [day('ann', '2026-03-16', 20)]), '2026-03-18');
    expect(s.pot).toBe(0);
    expect(s.players.every((p) => p.clean)).toBe(true);
  });

  it('at the end, whoever came up short owes; the rest are clean', () => {
    const s = challengeStandings(
      state(goal, [day('ann', '2026-03-16', 300), day('ann', '2026-03-18', 250), day('bo', '2026-03-16', 100)]),
      '2026-03-21',
    );
    expect(standing(s, 'ann')).toMatchObject({ points: 550, missed: 0, staked: 0, clean: true });
    expect(standing(s, 'bo')).toMatchObject({ points: 100, missed: 1, staked: 100 }); // ante × 5 days
    expect(s.pot).toBe(100);
    expect(standing(s, 'bo').owed).toBe(100);
  });
});

describe('challengeStandings — ordering', () => {
  it('puts the cleanest first, then the most work', () => {
    const s = challengeStandings(
      {
        challenge: challenge({ kind: 'streak' }),
        members: [
          { playerId: 'ann', name: 'Ann', joinedAt: 0 },
          { playerId: 'bo', name: 'Bo', joinedAt: 0 },
          { playerId: 'cy', name: 'Cy', joinedAt: 0 },
        ],
        days: [day('bo', '2026-03-16', 500), day('cy', '2026-03-16', 10), day('cy', '2026-03-17', 10)],
      },
      '2026-03-18',
    );
    expect(s.players.map((p) => p.playerId)).toEqual(['cy', 'bo', 'ann']);
  });
});

describe('ownStatus (what this device can work out on its own)', () => {
  const work = (entries: Record<string, [number, number]>) =>
    new Map(Object.entries(entries).map(([day, [points, workouts]]) => [day, { points, workouts }]));

  it('says whether today is done, and how far off it is', () => {
    const daily = challenge({ kind: 'daily', points: 100 });
    const mid = ownStatus(daily, work({ '2026-03-16': [100, 1], '2026-03-18': [40, 1] }), '2026-03-18');
    expect(mid).toMatchObject({ todayDone: false, todayPoints: 40, todayShort: 60, missed: 1, staked: 20, daysLeft: 3 });

    const done = ownStatus(daily, work({ '2026-03-18': [120, 1] }), '2026-03-18');
    expect(done).toMatchObject({ todayDone: true, todayShort: 0 });
  });

  it('counts a streak day by any workout', () => {
    const s = ownStatus(challenge({ kind: 'streak' }), work({ '2026-03-18': [3, 1] }), '2026-03-18');
    expect(s).toMatchObject({ todayDone: true, missed: 2, staked: 40 });
  });

  it('a total goal is done when the whole target is reached, and stakes nothing until the end', () => {
    const goal = { kind: 'total', points: 500 } as const;
    const part = ownStatus(challenge(goal), work({ '2026-03-16': [200, 1] }), '2026-03-18');
    expect(part).toMatchObject({ todayDone: false, todayShort: 300, points: 200, target: 500, staked: 0 });

    const reached = ownStatus(challenge(goal), work({ '2026-03-16': [500, 2] }), '2026-03-18');
    expect(reached).toMatchObject({ todayDone: true, todayShort: 0 });

    const short = ownStatus(challenge(goal), work({ '2026-03-16': [100, 1] }), '2026-03-21');
    expect(short).toMatchObject({ over: true, staked: 100 });
  });

  it('knows a challenge that has not started, and one that is over', () => {
    expect(ownStatus(challenge({ kind: 'streak' }), new Map(), '2026-03-10')).toMatchObject({ upcoming: true, missed: 0, daysLeft: 5 });
    expect(ownStatus(challenge({ kind: 'streak' }), new Map(), '2026-03-25')).toMatchObject({ over: true, daysLeft: 0, missed: 5 });
  });

  it('matches the shared standings for the same player', () => {
    const days = [day('ann', '2026-03-16', 30), day('ann', '2026-03-18', 30)];
    const shared = challengeStandings(state({ kind: 'streak' }, days), '2026-03-19');
    const own = ownStatus(challenge({ kind: 'streak' }), work({ '2026-03-16': [30, 1], '2026-03-18': [30, 1] }), '2026-03-19');
    const ann = shared.players.find((p) => p.playerId === 'ann')!;
    expect(own.missed).toBe(ann.missed);
    expect(own.staked).toBe(ann.staked);
    expect(own.points).toBe(ann.points);
  });
});
