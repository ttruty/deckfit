import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { GamesFileSchema } from '../app/domain/models/game.schema';
import { DecksFileSchema, ExercisesFileSchema } from '../app/domain/models/schemas';
import { DECKFIT_DB, DeckfitDb } from '../app/core/db/deckfit-db';
import type { ContentBundle } from '../app/core/db/seed-content';

/** Test-only helpers (imported by *.spec.ts; never by app code). */

let n = 0;

/** A Dexie database on its own in-memory IndexedDB, registered in TestBed. */
export function provideTestDb(): DeckfitDb {
  const db = new DeckfitDb(`deckfit-test-${++n}`, { indexedDB: new IDBFactory(), IDBKeyRange });
  TestBed.configureTestingModule({ providers: [{ provide: DECKFIT_DB, useValue: db }] });
  return db;
}

const read = (f: string): unknown => JSON.parse(readFileSync(join(process.cwd(), 'src/assets/content', f), 'utf8'));

/** The real built-in content, freshly parsed (safe to mutate per test). */
export function loadContent(): ContentBundle {
  return {
    exercises: ExercisesFileSchema.parse(read('exercises.json')),
    decks: DecksFileSchema.parse(read('decks.json')),
    games: GamesFileSchema.parse(read('games.json')),
  };
}
