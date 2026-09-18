import { TestBed } from '@angular/core/testing';
import type { Routine, Session } from '../../domain/models/schemas';
import type { DeckfitDb } from './deckfit-db';
import {
  DeckRepository, ExerciseRepository, GameRepository, MetaRepository, ReadOnlyError, RoutineRepository, SessionRepository,
} from './repositories';
import { seedContent } from './seed-content';
import { loadContent, provideTestDb } from '../../../testing/db';

const settings = { repMultiplier: 1, faceCardValue: 10, aceValue: 11, jokerRule: 'rest' as const, players: { min: 1, max: 1 } };
const routine = (id: string, favorite = false): Routine => ({ id, name: id, deckId: 'deck-bodyweight', gameId: 'solo-deal', settings, favorite, updatedAt: 0 });
const session = (id: string, startedAt: number): Session => {
  const deck = loadContent().decks.decks[0];
  return {
    id, seed: 1, startedAt,
    game: { id: 'solo-deal', name: 'Solo Deal' },
    deck: { id: deck.id, name: deck.name, suits: deck.suits, cards: deck.cards },
    settings, players: [{ id: 'p1', name: 'Me' }],
    log: [{ type: 'GameStarted', players: ['p1'] }], totals: { p1: { 'bw-air-squat': 10 } },
  };
};

describe('repositories', () => {
  let db: DeckfitDb;

  beforeEach(async () => {
    db = provideTestDb();
    await seedContent(db, loadContent());
  });

  describe('built-in content is read-only', () => {
    it('refuses to save over or delete built-ins', async () => {
      const decks = TestBed.inject(DeckRepository);
      const builtIn = (await decks.get('deck-bodyweight'))!;
      await expect(decks.save(builtIn)).rejects.toThrow(ReadOnlyError);
      await expect(decks.save({ ...builtIn, builtIn: false })).rejects.toThrow(ReadOnlyError);
      await expect(decks.delete('deck-bodyweight')).rejects.toThrow(ReadOnlyError);
      await expect(TestBed.inject(GameRepository).delete('solo-deal')).rejects.toThrow(ReadOnlyError);
      await expect(TestBed.inject(ExerciseRepository).delete('bw-air-squat')).rejects.toThrow(ReadOnlyError);
      expect(await db.decks.get('deck-bodyweight')).toEqual(builtIn);
    });

    it('splits built-in and user records', async () => {
      const decks = TestBed.inject(DeckRepository);
      await decks.duplicate('deck-bodyweight');
      expect((await decks.listBuiltIn()).length).toBe(10);
      expect((await decks.listMine()).length).toBe(1);
    });
  });

  describe('DeckRepository', () => {
    it('duplicates to an editable copy with fresh unique card ids', async () => {
      const decks = TestBed.inject(DeckRepository);
      const copy = await decks.duplicate('deck-bodyweight');
      expect(copy).toMatchObject({ name: 'Bodyweight deck (copy)', builtIn: false, basedOn: 'deck-bodyweight', category: 'bodyweight' });
      expect(copy.id).toMatch(/^deck-/);
      expect(copy.cards).toHaveLength(54);
      expect(new Set(copy.cards.map((c) => c.id)).size).toBe(54);
      const source = (await decks.get('deck-bodyweight'))!;
      expect(copy.cards.map(({ id: _, ...c }) => c)).toEqual(source.cards.map(({ id: _, ...c }) => c));

      const edited = await decks.save({ ...copy, name: 'Mine' });
      expect((await decks.get(copy.id))?.name).toBe('Mine');
      expect(edited.updatedAt).toBeGreaterThan(0);
      await decks.delete(copy.id);
      expect(await decks.get(copy.id)).toBeUndefined();
    });

    it('validates before writing', async () => {
      const decks = TestBed.inject(DeckRepository);
      const copy = await decks.duplicate('deck-bodyweight');
      await expect(decks.save({ ...copy, cards: [{ ...copy.cards[0], rank: 'JOKER' }] })).rejects.toThrow();
      expect((await decks.get(copy.id))?.cards).toHaveLength(54);
    });

    it('finds decks using an exercise', async () => {
      const decks = TestBed.inject(DeckRepository);
      expect((await decks.usingExercise('bw-air-squat')).map((d) => d.id)).toEqual(['deck-bodyweight']);
      await decks.duplicate('deck-bodyweight', 'Copy');
      expect((await decks.usingExercise('bw-air-squat')).map((d) => d.name).sort()).toEqual(['Bodyweight deck', 'Copy']);
    });
  });

  describe('RoutineRepository', () => {
    it('lists most recently saved first and filters favorites', async () => {
      const routines = TestBed.inject(RoutineRepository);
      // Stub only Date.now: fake timers stall Dexie's internal scheduling.
      const now = vi.spyOn(Date, 'now');
      try {
        now.mockReturnValue(1000);
        await routines.save(routine('a', true));
        now.mockReturnValue(2000);
        await routines.save(routine('b'));
        now.mockReturnValue(3000);
        await routines.save(routine('c', true));
      } finally {
        now.mockRestore();
      }
      expect((await routines.list()).map((r) => r.id)).toEqual(['c', 'b', 'a']);
      expect((await routines.favorites()).map((r) => r.id)).toEqual(['c', 'a']);
    });

    it('rejects invalid routines', async () => {
      await expect(TestBed.inject(RoutineRepository).save({ ...routine('x'), settings: { ...settings, repMultiplier: 9 } })).rejects.toThrow();
    });
  });

  describe('SessionRepository', () => {
    it('saves, checks existence, and lists newest first with a limit', async () => {
      const sessions = TestBed.inject(SessionRepository);
      await sessions.save(session('s1', 100));
      await sessions.save(session('s2', 300));
      await sessions.save(session('s3', 200));
      expect(await sessions.exists('s2')).toBe(true);
      expect(await sessions.exists('nope')).toBe(false);
      expect((await sessions.list()).map((s) => s.id)).toEqual(['s2', 's3', 's1']);
      expect((await sessions.list(2)).map((s) => s.id)).toEqual(['s2', 's3']);
    });
  });

  describe('MetaRepository', () => {
    it('gets and sets typed values', async () => {
      const meta = TestBed.inject(MetaRepository);
      expect(await meta.get('disclaimerAcceptedAt')).toBeUndefined();
      await meta.set('disclaimerAcceptedAt', 123);
      expect(await meta.get('disclaimerAcceptedAt')).toBe(123);
      expect(await meta.get('contentVersion')).toBe('e1.d1.g5');
    });
  });
});
