import { TestBed } from '@angular/core/testing';
import { MetaRepository } from '../db/repositories';
import type { Session } from '../../domain/models/schemas';
import { provideTestDb } from '../../../testing/db';
import { HabitsService, toHabitsEvent } from './habits.service';

const session = {
  id: 'session-1',
  seed: 1,
  startedAt: new Date(2026, 9, 1, 18, 0).getTime(),
  endedAt: new Date(2026, 9, 1, 18, 25, 30).getTime(),
  outcome: 'finished',
  game: { id: 'ladder', name: 'Ladder' },
  deck: { id: 'classic', name: 'Classic', suits: [], cards: [] },
  settings: {},
  players: [{ id: 'me', name: 'You' }],
  log: [],
  totals: {},
} as unknown as Session;

/** Lets Dexie writes and the reporter's microtasks settle. */
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('toHabitsEvent', () => {
  it('reports an ended session as a fact: length, game, deck, outcome', () => {
    expect(toHabitsEvent(session)).toEqual({
      externalId: 'session-1',
      type: 'workout.completed',
      occurredAt: new Date(session.endedAt!).toISOString(),
      localDate: '2026-10-01',
      value: 1530,
      unit: 'seconds',
      meta: { game: 'Ladder', deck: 'Classic', outcome: 'finished' },
    });
  });

  it('marks room games and abandoned ones, and skips sessions still in progress', () => {
    expect(toHabitsEvent({ ...session, roomId: 'ROOM1', outcome: 'abandoned' })?.meta).toEqual({
      game: 'Ladder',
      deck: 'Classic',
      outcome: 'abandoned',
      room: true,
    });
    expect(toHabitsEvent({ ...session, endedAt: undefined })).toBeNull();
  });
});

describe('HabitsService', () => {
  let meta: MetaRepository;

  beforeEach(() => {
    provideTestDb();
    TestBed.configureTestingModule({});
    meta = TestBed.inject(MetaRepository);
  });

  it('is off by default: nothing is queued', async () => {
    const habits = TestBed.inject(HabitsService);
    await habits.load();
    expect(habits.settings()).toEqual({ enabled: false, url: '', token: '' });
    habits.reportSession(session);
    await settle();
    expect(await meta.get('habitsQueue')).toBeUndefined();
  });

  it('queues in Dexie meta once switched on with a URL and token', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    const habits = TestBed.inject(HabitsService);
    await habits.update({
      enabled: true,
      url: 'https://x.supabase.co/functions/v1/ingest',
      token: 'hab_t',
    });
    expect(await meta.get('habitsReporting')).toEqual({
      enabled: true,
      url: 'https://x.supabase.co/functions/v1/ingest',
      token: 'hab_t',
    });
    habits.reportSession(session);
    await settle();
    expect(await meta.get('habitsQueue')).toEqual([toHabitsEvent(session)]);
  });

  it('ignores stored settings that fail validation', async () => {
    await meta.set('habitsReporting', { enabled: 'yes' } as never);
    const habits = TestBed.inject(HabitsService);
    await habits.load();
    expect(habits.settings().enabled).toBe(false);
  });
});
