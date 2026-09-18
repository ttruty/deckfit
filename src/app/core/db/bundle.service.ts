import { Injectable, inject } from '@angular/core';
import type { Table } from 'dexie';
import { BundleSchema, type Bundle } from '../../domain/models/bundle.schema';
import { DECKFIT_DB } from './deckfit-db';

export class BundleImportError extends Error {
  constructor(readonly problems: string[]) {
    super(`Import failed:\n- ${problems.join('\n- ')}`);
    this.name = 'BundleImportError';
  }
}

export interface ImportResult {
  added: number;
  replaced: number;
}

/** JSON bundle export/import (§10). Import validates everything before writing anything. */
@Injectable({ providedIn: 'root' })
export class BundleService {
  private readonly db = inject(DECKFIT_DB);

  /**
   * Everything user-made, or just the given routines plus the user decks/games/exercises
   * they need (for sharing and room invites). Built-ins are referenced by id, not copied.
   */
  async exportBundle(opts: { routineIds?: readonly string[] } = {}): Promise<Bundle> {
    const { db } = this;
    return db.transaction('r', [db.exercises, db.decks, db.games, db.routines], async () => {
      const allRoutines = await db.routines.toArray();
      const userDecks = (await db.decks.toArray()).filter((d) => !d.builtIn);
      const userGames = (await db.games.toArray()).filter((g) => !g.builtIn);
      const userExercises = (await db.exercises.toArray()).filter((e) => !e.builtIn);

      if (!opts.routineIds) {
        return BundleSchema.parse({
          format: 'deckfit-bundle', version: 1, exportedAt: Date.now(),
          exercises: userExercises, decks: userDecks, games: userGames, routines: allRoutines,
        });
      }

      const wanted = new Set(opts.routineIds);
      const routines = allRoutines.filter((r) => wanted.has(r.id));
      const missing = [...wanted].filter((id) => !routines.some((r) => r.id === id));
      if (missing.length) throw new Error(`Unknown routine(s): ${missing.join(', ')}`);
      const decks = userDecks.filter((d) => routines.some((r) => r.deckId === d.id));
      const games = userGames.filter((g) => routines.some((r) => r.gameId === g.id));
      const exerciseIds = new Set(decks.flatMap((d) => d.cards.map((c) => c.exerciseId)));
      const exercises = userExercises.filter((e) => exerciseIds.has(e.id));
      return BundleSchema.parse({ format: 'deckfit-bundle', version: 1, exportedAt: Date.now(), exercises, decks, games, routines });
    });
  }

  serialize(bundle: Bundle): string {
    return JSON.stringify(bundle, null, 2);
  }

  /** Accepts a parsed object or JSON text. User records with the same id are replaced. */
  async importBundle(input: unknown): Promise<ImportResult> {
    let raw = input;
    if (typeof input === 'string') {
      try {
        raw = JSON.parse(input);
      } catch {
        throw new BundleImportError(['not valid JSON']);
      }
    }
    const parsed = BundleSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BundleImportError(parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`));
    }
    const bundle = parsed.data;
    const { db } = this;

    // Problems are returned (not thrown) from the transaction: Dexie wraps errors thrown inside.
    type Outcome = { ok: true; result: ImportResult } | { ok: false; problems: string[] };
    const outcome = await db.transaction('rw', [db.exercises, db.decks, db.games, db.routines], async (): Promise<Outcome> => {
      const problems: string[] = [];
      let replaced = 0;

      // Collisions with built-ins are errors; with user records, replacements.
      const collide = async <T extends { id: string; builtIn: boolean }>(label: string, table: Table<T, string>, items: T[]) => {
        for (const row of await table.bulkGet(items.map((x) => x.id))) {
          if (!row) continue;
          if (row.builtIn) problems.push(`${label} ${row.id} would overwrite a built-in`);
          else replaced++;
        }
      };
      await collide('exercise', db.exercises, bundle.exercises);
      await collide('deck', db.decks, bundle.decks);
      await collide('game', db.games, bundle.games);
      replaced += (await db.routines.bulkGet(bundle.routines.map((r) => r.id))).filter(Boolean).length;

      // References must resolve within the bundle or the database.
      const unresolved = async <T extends { id: string }>(refs: Iterable<string>, bundled: T[], table: Table<T, string>) => {
        const local = new Set(bundled.map((x) => x.id));
        const lookup = [...new Set(refs)].filter((id) => !local.has(id));
        const found = await table.bulkGet(lookup);
        return lookup.filter((_, i) => !found[i]);
      };
      const exerciseRefs = bundle.decks.flatMap((d) => d.cards.flatMap((c) => (c.exerciseId ? [c.exerciseId] : [])));
      for (const id of await unresolved(exerciseRefs, bundle.exercises, db.exercises)) problems.push(`exercise ${id} is used by a deck but missing`);
      for (const id of await unresolved(bundle.routines.map((r) => r.deckId), bundle.decks, db.decks)) problems.push(`deck ${id} is used by a routine but missing`);
      for (const id of await unresolved(bundle.routines.map((r) => r.gameId), bundle.games, db.games)) problems.push(`game ${id} is used by a routine but missing`);

      if (problems.length) return { ok: false, problems };

      await db.exercises.bulkPut(bundle.exercises);
      await db.decks.bulkPut(bundle.decks);
      await db.games.bulkPut(bundle.games);
      await db.routines.bulkPut(bundle.routines);
      const total = bundle.exercises.length + bundle.decks.length + bundle.games.length + bundle.routines.length;
      return { ok: true, result: { added: total - replaced, replaced } };
    });
    if (!outcome.ok) throw new BundleImportError(outcome.problems);
    return outcome.result;
  }
}
