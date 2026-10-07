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
    // v2: a deck became four pools of exercises instead of 54 fixed cards (§9b). A deck someone
    // made under v1 keeps everything it could deal — each suit's pool is the exercises its cards
    // carried, in the order they first appeared — and the cards themselves go.
    this.version(2)
      .stores({})
      .upgrade((tx) =>
        tx
          .table<LegacyDeck, string>('decks')
          .toCollection()
          .modify((deck) => {
            if (!Array.isArray(deck.cards)) return;
            for (const mapping of deck.suits ?? []) {
              mapping.exerciseIds ??= [
                ...new Set(deck.cards.flatMap((c) => (c.suit === mapping.suit && c.exerciseId ? [c.exerciseId] : []))),
              ];
            }
            delete deck.cards;
          }),
      );
  }
}

/** A deck as v1 stored it, for the upgrade above only. */
interface LegacyDeck {
  cards?: { suit: string; exerciseId: string | null }[];
  suits?: { suit: string; exerciseIds?: string[] }[];
}

export const DECKFIT_DB = new InjectionToken<DeckfitDb>('DECKFIT_DB', {
  providedIn: 'root',
  factory: () => new DeckfitDb(),
});

/** Ids for user-created records. Built-in ids are human-readable (e.g. deck-bodyweight). */
export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
