import { TestBed } from '@angular/core/testing';
import type { Bundle } from '../../domain/models/bundle.schema';
import type { Exercise, Routine } from '../../domain/models/schemas';
import { BundleImportError, BundleService } from './bundle.service';
import type { DeckfitDb } from './deckfit-db';
import { DeckRepository, ExerciseRepository, GameRepository, RoutineRepository } from './repositories';
import { seedContent } from './seed-content';
import { loadContent, provideTestDb } from '../../../testing/db';

const settings = { repMultiplier: 1, faceCardValue: 10, aceValue: 11, jokerRule: 'rest' as const, players: { min: 1, max: 1 } };

/** A user with: a custom exercise used by a duplicated deck, a custom game, and three routines. */
async function makeUserData() {
  const content = loadContent();
  const myExercise: Exercise = { ...content.exercises.exercises[0], id: 'ex-mine', name: 'My Squat', builtIn: false };
  await TestBed.inject(ExerciseRepository).save(myExercise);
  const decks = TestBed.inject(DeckRepository);
  const copy = await decks.duplicate('deck-bodyweight', 'My deck');
  const myDeck = await decks.save({ ...copy, cards: copy.cards.map((c, i) => (i === 1 ? { ...c, exerciseId: 'ex-mine' } : c)) });
  const myGame = await TestBed.inject(GameRepository).save({ ...content.games.games[0], id: 'my-deal', name: 'My Deal', builtIn: false });
  const routines = TestBed.inject(RoutineRepository);
  const r = (id: string, deckId: string, gameId: string): Routine => ({ id, name: id, deckId, gameId, settings, favorite: false, updatedAt: 0 });
  await routines.save(r('r-custom', myDeck.id, myGame.id));
  await routines.save(r('r-builtin', 'deck-bodyweight', 'solo-deal'));
  await routines.save(r('r-mixed', myDeck.id, 'end-match'));
  return { myDeck, myGame, myExercise };
}

describe('BundleService', () => {
  let db: DeckfitDb;
  let service: BundleService;

  beforeEach(async () => {
    db = provideTestDb();
    await seedContent(db, loadContent());
    service = TestBed.inject(BundleService);
  });

  describe('export', () => {
    it('exports everything user-made and no built-ins', async () => {
      const { myDeck } = await makeUserData();
      const bundle = await service.exportBundle();
      expect(bundle).toMatchObject({ format: 'deckfit-bundle', version: 1 });
      expect(bundle.exercises.map((e) => e.id)).toEqual(['ex-mine']);
      expect(bundle.decks.map((d) => d.id)).toEqual([myDeck.id]);
      expect(bundle.games.map((g) => g.id)).toEqual(['my-deal']);
      expect(bundle.routines.map((r) => r.id).sort()).toEqual(['r-builtin', 'r-custom', 'r-mixed']);
    });

    it('exports selected routines with only the user items they need', async () => {
      const { myDeck } = await makeUserData();
      const builtInOnly = await service.exportBundle({ routineIds: ['r-builtin'] });
      expect([builtInOnly.exercises, builtInOnly.decks, builtInOnly.games].map((x) => x.length)).toEqual([0, 0, 0]);
      const mixed = await service.exportBundle({ routineIds: ['r-mixed'] });
      expect(mixed.decks.map((d) => d.id)).toEqual([myDeck.id]);
      expect(mixed.games).toEqual([]);
      expect(mixed.exercises.map((e) => e.id)).toEqual(['ex-mine']);
      await expect(service.exportBundle({ routineIds: ['nope'] })).rejects.toThrow(/nope/);
    });
  });

  describe('import', () => {
    let bundle: Bundle;

    beforeEach(async () => {
      await makeUserData();
      bundle = JSON.parse(service.serialize(await service.exportBundle()));
      // Fresh device: only built-in content.
      TestBed.resetTestingModule();
      db = provideTestDb();
      await seedContent(db, loadContent());
      service = TestBed.inject(BundleService);
    });

    it('round-trips into another database, then replaces on re-import', async () => {
      expect(await service.importBundle(service.serialize(bundle))).toEqual({ added: 6, replaced: 0 });
      expect((await service.exportBundle()).routines.length).toBe(3);
      expect((await db.exercises.get('ex-mine'))?.name).toBe('My Squat');
      expect(await service.importBundle(bundle)).toEqual({ added: 0, replaced: 6 });
    });

    const expectNothingWritten = async () => {
      expect(await db.routines.count()).toBe(0);
      expect(await db.exercises.get('ex-mine')).toBeUndefined();
    };

    it('rejects non-JSON and schema-invalid input without writing', async () => {
      await expect(service.importBundle('{nope')).rejects.toThrow(BundleImportError);
      const invalid = { ...bundle, routines: [{ ...bundle.routines[0], settings: { ...settings, jokerRule: 'dance' } }] };
      const err = await service.importBundle(invalid).catch((e: BundleImportError) => e);
      expect(err).toBeInstanceOf(BundleImportError);
      expect((err as BundleImportError).problems[0]).toMatch(/^routines\.0\.settings\.jokerRule/);
      await expectNothingWritten();
    });

    it('rejects bundles containing built-ins', async () => {
      const withBuiltIn = { ...bundle, decks: [...bundle.decks, (await db.decks.get('deck-yoga'))!] };
      await expect(service.importBundle(withBuiltIn)).rejects.toThrow(/built-in/);
      await expectNothingWritten();
    });

    it('rejects user items that would overwrite a built-in id', async () => {
      const clash = { ...bundle, games: [{ ...bundle.games[0], id: 'solo-deal' }] };
      const err = (await service.importBundle(clash).catch((e: BundleImportError) => e)) as BundleImportError;
      expect(err.problems).toContain('game solo-deal would overwrite a built-in');
      await expectNothingWritten();
    });

    it('rejects dangling references and writes nothing', async () => {
      const dangling = { ...bundle, exercises: [], games: [] };
      const err = (await service.importBundle(dangling).catch((e: BundleImportError) => e)) as BundleImportError;
      expect(err.problems.sort()).toEqual(['exercise ex-mine is used by a deck but missing', 'game my-deal is used by a routine but missing']);
      await expectNothingWritten();
    });
  });
});
