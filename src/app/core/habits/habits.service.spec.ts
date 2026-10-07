import { TestBed } from '@angular/core/testing';
import { MetaRepository } from '../db/repositories';
import type { DeckfitDb } from '../db/deckfit-db';
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

  it('reports an unfinished workout once a card is done, as in progress', () => {
    const lastActiveAt = session.startedAt + 90_000;
    const started = { ...session, endedAt: undefined, outcome: undefined, lastActiveAt };
    expect(toHabitsEvent({ ...started, totals: { me: { squat: 0 } } })).toBeNull();
    expect(toHabitsEvent({ ...started, totals: { me: { squat: 10 } } })).toMatchObject({
      externalId: 'session-1',
      occurredAt: new Date(lastActiveAt).toISOString(),
      localDate: '2026-10-01',
      value: 90,
      meta: { outcome: 'in_progress' },
    });
  });
});

describe('HabitsService', () => {
  let meta: MetaRepository;
  let db: DeckfitDb;

  beforeEach(() => {
    db = provideTestDb();
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

  it('catches up: re-sends workouts that ended in the last week, only when on', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const now = Date.now();
    const recent = { ...session, id: 'session-recent', startedAt: now - 60_000, endedAt: now };
    const old = { ...session, id: 'session-old', startedAt: now - 9e8, endedAt: now - 8.9e8 };
    const running = { ...session, id: 'session-running', startedAt: now, endedAt: undefined };
    const left = {
      ...session,
      id: 'session-left',
      startedAt: now - 120_000,
      endedAt: undefined,
      lastActiveAt: now - 60_000,
      totals: { me: { squat: 5 } },
    };
    await db.sessions.bulkPut([recent, old, running, left]); // partial sessions: skip the repo's schema

    const habits = TestBed.inject(HabitsService);
    await habits.catchUp();
    expect(fetch).not.toHaveBeenCalled();

    await habits.update({ enabled: true, url: 'https://x/ingest', token: 'hab_t' });
    await habits.catchUp();
    expect(fetch).toHaveBeenCalled();
    const body = JSON.parse(fetch.mock.calls[0][1]!.body as string);
    expect(body.events.map((e: { externalId: string }) => e.externalId).sort()).toEqual([
      'session-left',
      'session-recent',
    ]);
    expect(await meta.get('habitsQueue')).toEqual([]);
  });

  it('ignores stored settings that fail validation', async () => {
    await meta.set('habitsReporting', { enabled: 'yes' } as never);
    const habits = TestBed.inject(HabitsService);
    await habits.load();
    expect(habits.settings().enabled).toBe(false);
  });
});
