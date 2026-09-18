import { InjectionToken } from '@angular/core';
import Dexie, { type DexieOptions, type Table } from 'dexie';
import type { GameDefinition } from '../../domain/models/game.schema';
import type { Deck, Exercise, Routine, Session } from '../../domain/models/schemas';

/** Key/value rows for app-level facts (content version, disclaimer, preferences). */
export interface MetaRow {
  key: string;
  value: unknown;
}

/**
 * IndexedDB schema (§10). Only real key types are indexed: IndexedDB cannot index
 * booleans, so `builtIn`/`favorite` are filtered in memory (tables are small).
 * Bump the version and add an upgrade when changing indexes; never edit a shipped version.
 */
export class DeckfitDb extends Dexie {
  exercises!: Table<Exercise, string>;
  decks!: Table<Deck, string>;
  games!: Table<GameDefinition, string>;
  routines!: Table<Routine, string>;
  sessions!: Table<Session, string>;
  meta!: Table<MetaRow, string>;

  constructor(name = 'deckfit', options?: DexieOptions) {
    super(name, options);
    this.version(1).stores({
      exercises: 'id, category',
      decks: 'id, updatedAt',
      games: 'id',
      routines: 'id, updatedAt, deckId, gameId',
      sessions: 'id, startedAt, routineId',
      meta: 'key',
    });
  }
}

export const DECKFIT_DB = new InjectionToken<DeckfitDb>('DECKFIT_DB', {
  providedIn: 'root',
  factory: () => new DeckfitDb(),
});

/** Ids for user-created records. Built-in ids are human-readable (e.g. deck-bodyweight). */
export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
