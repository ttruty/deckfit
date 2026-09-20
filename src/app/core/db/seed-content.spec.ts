import type { Deck, Routine } from '../../domain/models/schemas';
import type { DeckfitDb } from './deckfit-db';
import { contentVersion, seedContent, type ContentBundle } from './seed-content';
import { loadContent, provideTestDb } from '../../../testing/db';

const routine = (over: Partial<Routine> = {}): Routine => ({
  id: 'r1', name: 'Morning', deckId: 'deck-bodyweight', gameId: 'solo-deal',
  settings: { repMultiplier: 1, faceCardValue: 10, aceValue: 11, jokerRule: 'rest', players: { min: 1, max: 1 } },
  favorite: false, updatedAt: 1, ...over,
});

describe('seedContent', () => {
  let db: DeckfitDb;
  let content: ContentBundle;

  beforeEach(() => {
    db = provideTestDb();
    content = loadContent();
  });

  it('seeds all built-in content on first run and stamps the version', async () => {
    const result = await seedContent(db, content);
    expect(result).toMatchObject({ seeded: true, version: 'e1.d1.g6', written: { exercises: 120, decks: 10, games: 10 }, skipped: [], removed: [] });
    expect(await db.exercises.count()).toBe(120);
    expect(await db.decks.count()).toBe(10);
    expect(await db.games.count()).toBe(10);
    expect((await db.meta.get('contentVersion'))?.value).toBe(contentVersion(content));
  });

  it('does nothing when the version is unchanged', async () => {
    await seedContent(db, content);
    await db.exercises.update('bw-air-squat', { name: 'Locally changed' });
    expect((await seedContent(db, content)).seeded).toBe(false);
    expect((await db.exercises.get('bw-air-squat'))?.name).toBe('Locally changed');
  });

  it('reseeds built-ins on a version bump', async () => {
    await seedContent(db, content);
    content.exercises.version = 2;
    content.exercises.exercises[0].name = 'Air Squat v2';
    const result = await seedContent(db, content);
    expect(result).toMatchObject({ seeded: true, version: 'e2.d1.g6' });
    expect((await db.exercises.get('bw-air-squat'))?.name).toBe('Air Squat v2');
  });

  it('never overwrites a user record, even one sharing a built-in id', async () => {
    const mine: Deck = { ...content.decks.decks[0], name: 'My deck', builtIn: false };
    await db.decks.put(mine);
    const result = await seedContent(db, content);
    expect(result.skipped).toEqual(['deck-bodyweight']);
    expect(await db.decks.get('deck-bodyweight')).toEqual(mine);
  });

  it('leaves duplicated decks untouched across reseeds', async () => {
    await seedContent(db, content);
    const copy: Deck = { ...content.decks.decks[0], id: 'deck-copy', basedOn: 'deck-bodyweight', builtIn: false, name: 'Copy' };
    await db.decks.put(copy);
    content.decks.version = 2;
    content.decks.decks[0].name = 'Bodyweight v2';
    await seedContent(db, content);
    expect(await db.decks.get('deck-copy')).toEqual(copy);
    expect((await db.decks.get('deck-bodyweight'))?.name).toBe('Bodyweight v2');
  });

  it('removes built-ins dropped from content unless user data references them', async () => {
    await seedContent(db, content);
    await db.routines.put(routine({ deckId: 'deck-yoga', gameId: 'end-match' }));
    const userDeck: Deck = {
      ...content.decks.decks[0], id: 'deck-mine', builtIn: false,
      cards: content.decks.decks[0].cards.map((c) => (c.id === 'bodyweight-hearts-2' ? { ...c, exerciseId: 'db-goblet-squat' } : c)),
    };
    await db.decks.put(userDeck);

    content.decks.version = 2;
    content.decks.decks = content.decks.decks.filter((d) => d.id !== 'deck-yoga' && d.id !== 'deck-running');
    content.games.version = 2;
    content.games.games = content.games.games.filter((g) => g.id !== 'end-match');
    content.exercises.version = 2;
    content.exercises.exercises = content.exercises.exercises.filter((e) => e.id !== 'db-goblet-squat' && e.id !== 'db-floor-press');

    const result = await seedContent(db, content);
    expect(result.removed.sort()).toEqual(['db-floor-press', 'deck-running']);
    expect(await db.decks.get('deck-yoga')).toBeDefined(); // routine uses it
    expect(await db.games.get('end-match')).toBeDefined(); // routine uses it
    expect(await db.exercises.get('db-goblet-squat')).toBeDefined(); // user deck uses it
  });

  it('is all-or-nothing', async () => {
    const broken = loadContent();
    broken.games.games.push({ ...broken.games.games[0], id: undefined as unknown as string });
    await expect(seedContent(db, broken)).rejects.toThrow();
    expect(await db.exercises.count()).toBe(0);
    expect(await db.meta.get('contentVersion')).toBeUndefined();
  });
});
