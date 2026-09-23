import { TestBed } from '@angular/core/testing';
import { provideTestDb } from '../../../testing/db';
import { provideFakeClock } from '../../../testing/fake-clock';
import type { Session } from '../../domain/models/schemas';
import { SessionRepository } from '../db/repositories';
import { IdentityService } from '../identity/identity.service';
import { REALTIME_CONFIGURED } from '../sync/realtime-config';
import { MemoryChallengeGateway } from './challenge-gateway';
import { CHALLENGE_GATEWAY_FACTORY } from './challenge.providers';
import { ChallengeService } from './challenge.service';

const at = (date: string, hour = 12) => new Date(`${date}T${String(hour).padStart(2, '0')}:00:00`).getTime();

/** A finished solo workout worth `reps` on that local day. */
function workout(id: string, date: string, reps: number, me = 'me'): Session {
  const task = { id: 't1', playerId: me, kind: 'exercise' as const, exerciseId: 'ex-squat', cardIds: ['c1'], amount: reps, measure: 'reps' as const, status: 'done' as const };
  return {
    id,
    seed: 1,
    startedAt: at(date),
    endedAt: at(date) + 600_000,
    outcome: 'finished',
    playerId: me,
    game: { id: 'solo-deal', name: 'Solo Deal' },
    deck: { id: 'deck-bodyweight', name: 'Bodyweight deck', suits: [], cards: [] },
    settings: { repMultiplier: 1, faceCardValue: 10, aceValue: 11, jokerRule: 'rest', players: { min: 1, max: 1 } },
    players: [{ id: me, name: 'Me' }],
    log: [
      { type: 'TaskAssigned', task },
      { type: 'TaskCompleted', taskId: 't1', playerId: me, amount: reps, exerciseKey: 'ex-squat' },
    ],
    totals: { [me]: { 'ex-squat': reps } },
  } as unknown as Session;
}

/**
 * One shared gateway, two devices: each TestBed is a device (its own Dexie, its own identity),
 * and they meet in the same in-memory backend — the same shape as two phones on Supabase.
 */
function device(gateway: MemoryChallengeGateway, now: number) {
  TestBed.resetTestingModule();
  provideTestDb();
  const clock = provideFakeClock(now);
  TestBed.configureTestingModule({
    providers: [
      { provide: REALTIME_CONFIGURED, useValue: true },
      { provide: CHALLENGE_GATEWAY_FACTORY, useValue: () => gateway },
    ],
  });
  return {
    challenges: TestBed.inject(ChallengeService),
    sessions: TestBed.inject(SessionRepository),
    identity: TestBed.inject(IdentityService),
    clock,
  };
}

const CHALLENGE = {
  name: 'Five day streak',
  goal: { kind: 'streak' } as const,
  ante: 20,
  startsOn: '2026-03-16',
  endsOn: '2026-03-20',
};

describe('ChallengeService (two devices, one backend)', () => {
  it('creates a challenge, joins the creator, and reports their work', async () => {
    const gateway = new MemoryChallengeGateway();
    const ann = device(gateway, at('2026-03-17'));
    await ann.sessions.save(workout('s1', '2026-03-16', 40, (await ann.identity.me()).id));

    const challenge = await ann.challenges.create(CHALLENGE);
    expect(challenge.code).toMatch(/^[A-Z0-9]{6}$/);

    const view = (await ann.challenges.open(challenge.code))!;
    expect(view.joined).toBe(true);
    expect(view.standings.players).toHaveLength(1);
    expect(view.standings.players[0]).toMatchObject({ made: 1, missed: 0, points: 40 });
  });

  it('a second device joins by code and both see each other’s days', async () => {
    const gateway = new MemoryChallengeGateway();
    const ann = device(gateway, at('2026-03-18'));
    const annId = (await ann.identity.me()).id;
    await ann.sessions.save(workout('s1', '2026-03-16', 40, annId));
    await ann.sessions.save(workout('s2', '2026-03-17', 60, annId));
    const challenge = await ann.challenges.create(CHALLENGE);

    const bo = device(gateway, at('2026-03-18'));
    const boId = (await bo.identity.me()).id;
    expect(boId).not.toBe(annId);
    await bo.sessions.save(workout('s3', '2026-03-17', 30, boId));
    await bo.challenges.join(challenge.code);

    const view = (await bo.challenges.open(challenge.code))!;
    expect(view.state.members.map((m) => m.playerId).sort()).toEqual([annId, boId].sort());
    const mine = view.standings.players.find((p) => p.playerId === boId)!;
    const theirs = view.standings.players.find((p) => p.playerId === annId)!;
    expect(mine).toMatchObject({ made: 1, missed: 1, points: 30 }); // missed the 16th
    expect(theirs).toMatchObject({ made: 2, missed: 0, points: 100 });
    expect(view.standings.pot).toBe(20);
  });

  it('only ever writes its own days', async () => {
    const gateway = new MemoryChallengeGateway();
    const ann = device(gateway, at('2026-03-18'));
    const annId = (await ann.identity.me()).id;
    const challenge = await ann.challenges.create(CHALLENGE);

    const bo = device(gateway, at('2026-03-18'));
    const boId = (await bo.identity.me()).id;
    await bo.sessions.save(workout('s1', '2026-03-16', 30, boId));
    await bo.challenges.join(challenge.code);

    const state = (await gateway.byCode(challenge.code))!;
    expect(state.days.every((d) => d.playerId === boId)).toBe(true);
    expect(state.days.some((d) => d.playerId === annId)).toBe(false);
  });

  it('a later workout updates the day it belongs to, and nothing else is re-sent', async () => {
    const gateway = new MemoryChallengeGateway();
    const ann = device(gateway, at('2026-03-17'));
    const me = (await ann.identity.me()).id;
    await ann.sessions.save(workout('s1', '2026-03-16', 40, me));
    const challenge = await ann.challenges.create(CHALLENGE);

    const before = (await gateway.byCode(challenge.code))!.days;
    expect(before).toEqual([{ playerId: me, day: '2026-03-16', points: 40, workouts: 1 }]);

    await ann.sessions.save(workout('s2', '2026-03-16', 25, me));
    await ann.challenges.syncAll();
    expect((await gateway.byCode(challenge.code))!.days).toEqual([
      { playerId: me, day: '2026-03-16', points: 65, workouts: 2 },
    ]);
  });

  it('when it is over, the misser owes the pot, and later work pays it down', async () => {
    const gateway = new MemoryChallengeGateway();
    const ann = device(gateway, at('2026-03-21')); // the day after it ends
    const me = (await ann.identity.me()).id;
    for (const [i, day] of ['2026-03-16', '2026-03-17', '2026-03-18'].entries()) {
      await ann.sessions.save(workout(`s${i}`, day, 30, me));
    }
    const challenge = await ann.challenges.create(CHALLENGE);

    let view = (await ann.challenges.open(challenge.code))!;
    expect(view.standings.over).toBe(true);
    expect(view.standings.players[0]).toMatchObject({ made: 3, missed: 2, staked: 40, owed: 40 });
    expect(view.myDebt).toBe(40);

    // Work after the last day pays the debt off.
    await ann.sessions.save(workout('s9', '2026-03-21', 25, me));
    view = (await ann.challenges.open(challenge.code))!;
    expect(view.myDebt).toBe(15);
  });

  it('peeking at a code shows the terms without taking a seat', async () => {
    const gateway = new MemoryChallengeGateway();
    const ann = device(gateway, at('2026-03-17'));
    const challenge = await ann.challenges.create(CHALLENGE);

    const bo = device(gateway, at('2026-03-17'));
    const seen = await bo.challenges.peek(challenge.code);
    expect(seen?.challenge.name).toBe('Five day streak');
    expect(seen?.members).toHaveLength(1);
    expect((await bo.challenges.open(challenge.code))!.joined).toBe(false);
    expect((await gateway.byCode(challenge.code))!.members).toHaveLength(1);
  });

  it('an unknown code is not found', async () => {
    const gateway = new MemoryChallengeGateway();
    const ann = device(gateway, at('2026-03-17'));
    expect(await ann.challenges.peek('ZZZZZZ')).toBeNull();
    await expect(ann.challenges.join('ZZZZZZ')).rejects.toThrow(/No challenge/);
  });

  it('leaving gives up the seat', async () => {
    const gateway = new MemoryChallengeGateway();
    const ann = device(gateway, at('2026-03-17'));
    const challenge = await ann.challenges.create(CHALLENGE);
    const bo = device(gateway, at('2026-03-17'));
    await bo.challenges.join(challenge.code);
    expect((await gateway.byCode(challenge.code))!.members).toHaveLength(2);

    await bo.challenges.leave(challenge.id);
    expect((await gateway.byCode(challenge.code))!.members).toHaveLength(1);
    expect(await bo.challenges.mine()).toEqual([]);
  });
});
