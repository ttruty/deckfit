import type { Table } from 'dexie';
import type { GamesFile } from '../../domain/models/game.schema';
import type { DecksFile, ExercisesFile } from '../../domain/models/schemas';
import type { DeckfitDb } from './deckfit-db';

export interface ContentBundle {
  exercises: ExercisesFile;
  decks: DecksFile;
  games: GamesFile;
}

export interface SeedResult {
  seeded: boolean;
  version: string;
  written: { exercises: number; decks: number; games: number };
  /** Built-in ids that collided with a user record and were left alone. */
  skipped: string[];
  /** Built-ins dropped from content and removed (unreferenced ones only). */
  removed: string[];
}

/** One version string for the whole bundle; bumping any file's `version` reseeds. */
export function contentVersion(bundle: ContentBundle): string {
  return `e${bundle.exercises.version}.d${bundle.decks.version}.g${bundle.games.version}`;
}

/**
 * Seeds built-in content on first run and whenever the content version changes (§10).
 * - Upserts built-ins; a record whose existing row is a user item (builtIn false) is never overwritten.
 * - Built-ins removed from content are deleted unless user data references them
 *   (a routine's deck/game, or a user deck card's exercise); those stay.
 * - Everything, including the version stamp, is one transaction: all or nothing.
 * The bundle must already be Zod-validated.
 */
export async function seedContent(db: DeckfitDb, bundle: ContentBundle, opts: { force?: boolean } = {}): Promise<SeedResult> {
  const version = contentVersion(bundle);
  const result: SeedResult = { seeded: false, version, written: { exercises: 0, decks: 0, games: 0 }, skipped: [], removed: [] };

  return db.transaction('rw', [db.exercises, db.decks, db.games, db.routines, db.meta], async () => {
    const current = (await db.meta.get('contentVersion'))?.value;
    if (current === version && !opts.force) return result;

    const routines = await db.routines.toArray();
    const userDecks = (await db.decks.toArray()).filter((d) => !d.builtIn);
    const referenced = {
      exercises: new Set(userDecks.flatMap((d) => d.cards.map((c) => c.exerciseId).filter((id): id is string => !!id))),
      decks: new Set(routines.map((r) => r.deckId)),
      games: new Set(routines.map((r) => r.gameId)),
    };

    const sync = async <T extends { id: string; builtIn: boolean }>(
      t: Table<T, string>,
      incoming: T[],
      key: keyof SeedResult['written'],
    ) => {
      const existing = new Map((await t.toArray()).map((x) => [x.id, x]));
      const writable = incoming.filter((item) => {
        const prior = existing.get(item.id);
        if (prior && !prior.builtIn) {
          result.skipped.push(item.id);
          return false;
        }
        return true;
      });
      await t.bulkPut(writable.map((item) => ({ ...item, builtIn: true })));
      result.written[key] = writable.length;

      const incomingIds = new Set(incoming.map((x) => x.id));
      const stale = [...existing.values()]
        .filter((x) => x.builtIn && !incomingIds.has(x.id) && !referenced[key].has(x.id))
        .map((x) => x.id);
      await t.bulkDelete(stale);
      result.removed.push(...stale);
    };

    await sync(db.exercises, bundle.exercises.exercises, 'exercises');
    await sync(db.decks, bundle.decks.decks, 'decks');
    await sync(db.games, bundle.games.games, 'games');
    await db.meta.put({ key: 'contentVersion', value: version });
    result.seeded = true;
    return result;
  });
}
