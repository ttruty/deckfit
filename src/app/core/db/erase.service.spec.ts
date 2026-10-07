import { TestBed } from '@angular/core/testing';
import type { Routine, Session } from '../../domain/models/schemas';
import { loadContent, provideTestDb } from '../../../testing/db';
import { ContentSeedService } from '../content/content-seed.service';
import { HabitsService } from '../habits/habits.service';
import { IdentityService } from '../identity/identity.service';
import { PreferencesService } from '../settings/preferences.service';
import type { DeckfitDb } from './deckfit-db';
import { DataEraseService } from './erase.service';
import { DeckRepository, MetaRepository, RoutineRepository, SessionRepository } from './repositories';
import { seedContent } from './seed-content';
import { dealtSnapshot } from '../../../testing/deck';

const settings = { repMultiplier: 1, faceCardValue: 10, aceValue: 11, jokerRule: 'rest' as const, players: { min: 1, max: 1 } };

function session(id: string, startedAt: number): Session {
  const content = loadContent();
  const deck = content.decks.decks[0];
  return {
    id, seed: 1, startedAt, endedAt: startedAt + 1000, outcome: 'finished',
    game: { id: 'solo-deal', name: 'Solo Deal' },
    deck: dealtSnapshot(deck, content.exercises.exercises),
    settings, players: [{ id: 'device-1', name: 'Ann' }], log: [], totals: { 'device-1': {} },
  };
}

describe('DataEraseService', () => {
  let db: DeckfitDb;
  let service: DataEraseService;

  beforeEach(async () => {
    db = provideTestDb();
    // The real seeder fetches assets/content over HTTP; the content is already on disk here.
    TestBed.configureTestingModule({
      providers: [{ provide: ContentSeedService, useValue: { ensureSeeded: () => seedContent(db, loadContent()) } }],
    });
    await seedContent(db, loadContent());
    service = TestBed.inject(DataEraseService);

    const myDeck = await TestBed.inject(DeckRepository).duplicate('deck-bodyweight', 'My deck');
    const routine: Routine = { id: 'r1', name: 'Mine', deckId: myDeck.id, gameId: 'solo-deal', settings, favorite: true, updatedAt: 0 };
    await TestBed.inject(RoutineRepository).save(routine);
    await TestBed.inject(SessionRepository).save(session('s1', 1_000));
    await TestBed.inject(SessionRepository).save(session('s2', 2_000));
    await TestBed.inject(IdentityService).rename('Ann');
  });

  it('counts what an erase would take', async () => {
    expect(await service.summary()).toEqual({ workouts: 2, decks: 1, games: 0, exercises: 0, routines: 1 });
  });

  it('clearHistory deletes the workouts and leaves everything else', async () => {
    expect(await service.clearHistory()).toBe(2);
    expect(await db.sessions.count()).toBe(0);
    expect(await db.routines.count()).toBe(1);
    expect((await db.decks.toArray()).filter((d) => !d.builtIn)).toHaveLength(1);
    // Nothing to clear the second time, and it doesn't throw.
    expect(await service.clearHistory()).toBe(0);
  });

  it('eraseEverything empties every table, then puts the built-ins back', async () => {
    const before = (await db.decks.toArray()).filter((d) => d.builtIn).length;
    await service.eraseEverything();

    expect(await db.sessions.count()).toBe(0);
    expect(await db.routines.count()).toBe(0);
    expect((await db.decks.toArray()).filter((d) => !d.builtIn)).toEqual([]);
    expect((await db.games.toArray()).every((g) => g.builtIn)).toBe(true);
    // Usable again without a reload: the built-in content is seeded back in the same breath.
    expect((await db.decks.toArray()).filter((d) => d.builtIn)).toHaveLength(before);
    expect(await db.exercises.count()).toBeGreaterThan(0);
  });

  it('forgets who the device was: a new id, the default name, and default settings', async () => {
    const identity = TestBed.inject(IdentityService);
    const was = await identity.me();
    expect(was.name).toBe('Ann');

    const prefs = TestBed.inject(PreferencesService);
    prefs.intensity.set('high');
    prefs.deckLength.set(12);
    await service.eraseEverything();

    const now = await identity.me();
    expect(now.id).not.toBe(was.id);
    expect(now.name).toBe('You');
    expect(prefs.intensity()).toBe('moderate');
    expect(prefs.deckLength()).toBeNull();
  });

  it('takes the Habits connection with it, in memory and in meta', async () => {
    const habits = TestBed.inject(HabitsService);
    await habits.update({ enabled: true, url: 'https://habits.example/ingest', token: 'hab_secret' });
    expect(await TestBed.inject(MetaRepository).get('habitsReporting')).toMatchObject({ token: 'hab_secret' });

    await service.eraseEverything();
    expect(habits.settings()).toEqual({ enabled: false, url: '', token: '' });
    expect(await TestBed.inject(MetaRepository).get('habitsReporting')).toBeUndefined();
  });

  it('reports that there were no shared challenge rows to clear', async () => {
    expect(await service.eraseEverything()).toEqual({ challenges: null });
  });
});
