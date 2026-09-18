import { Injectable, inject } from '@angular/core';
import type { Table } from 'dexie';
import type { ZodType } from 'zod';
import { GameDefinitionSchema, type GameDefinition } from '../../domain/models/game.schema';
import {
  DeckSchema, ExerciseSchema, RoutineSchema, SessionSchema,
  type Deck, type Exercise, type Routine, type Session,
} from '../../domain/models/schemas';
import { DECKFIT_DB, newId } from './deckfit-db';

export class ReadOnlyError extends Error {
  constructor(what: string) {
    super(`${what} is built-in and read-only; duplicate it to edit`);
    this.name = 'ReadOnlyError';
  }
}

/**
 * Validated CRUD over one Dexie table. Built-in records are read-only through
 * repositories; only content seeding (./seed-content.ts) writes them.
 */
abstract class ContentRepository<T extends { id: string; builtIn: boolean }> {
  protected abstract readonly table: Table<T, string>;
  protected abstract readonly schema: ZodType<T>;
  protected abstract readonly label: string;

  get(id: string): Promise<T | undefined> {
    return this.table.get(id);
  }

  list(): Promise<T[]> {
    return this.table.toArray();
  }

  async listBuiltIn(): Promise<T[]> {
    return (await this.list()).filter((x) => x.builtIn);
  }

  async listMine(): Promise<T[]> {
    return (await this.list()).filter((x) => !x.builtIn);
  }

  /** Validates and upserts a user record. */
  async save(item: T): Promise<T> {
    const parsed = this.schema.parse(item);
    if (parsed.builtIn) throw new ReadOnlyError(`${this.label} ${parsed.id}`);
    const written = await this.writeUnlessBuiltIn(parsed.id, () => this.table.put(parsed));
    if (!written) throw new ReadOnlyError(`${this.label} ${parsed.id}`);
    return parsed;
  }

  async delete(id: string): Promise<void> {
    const written = await this.writeUnlessBuiltIn(id, () => this.table.delete(id));
    if (!written) throw new ReadOnlyError(`${this.label} ${id}`);
  }

  /**
   * Check-and-write in one transaction. Returns false instead of throwing inside the
   * transaction, because Dexie wraps errors thrown there (breaking `instanceof`).
   */
  private writeUnlessBuiltIn(id: string, write: () => Promise<unknown>): Promise<boolean> {
    return this.table.db.transaction('rw', this.table, async () => {
      if ((await this.table.get(id))?.builtIn) return false;
      await write();
      return true;
    });
  }
}

@Injectable({ providedIn: 'root' })
export class ExerciseRepository extends ContentRepository<Exercise> {
  protected readonly table = inject(DECKFIT_DB).exercises;
  protected readonly schema = ExerciseSchema;
  protected readonly label = 'Exercise';

  getMany(ids: readonly string[]): Promise<(Exercise | undefined)[]> {
    return this.table.bulkGet([...ids]);
  }
}

@Injectable({ providedIn: 'root' })
export class DeckRepository extends ContentRepository<Deck> {
  private readonly db = inject(DECKFIT_DB);
  protected readonly table = this.db.decks;
  protected readonly schema = DeckSchema;
  protected readonly label = 'Deck';

  override save(deck: Deck): Promise<Deck> {
    return super.save({ ...deck, updatedAt: Date.now() });
  }

  /** "Duplicate to edit": an editable copy with fresh card ids, remembering its origin. */
  async duplicate(id: string, name?: string): Promise<Deck> {
    const source = await this.get(id);
    if (!source) throw new Error(`Deck ${id} not found`);
    const copyId = newId('deck');
    const { category, ...rest } = source;
    return this.save({
      ...rest,
      ...(category ? { category } : {}),
      id: copyId,
      name: name ?? `${source.name} (copy)`,
      builtIn: false,
      basedOn: source.id,
      cards: source.cards.map((c, i) => ({ ...c, id: `${copyId}-${i}` })),
      updatedAt: Date.now(),
    });
  }

  /** Decks whose cards use the exercise ("used in decks"). */
  async usingExercise(exerciseId: string): Promise<Deck[]> {
    return (await this.list()).filter((d) => d.cards.some((c) => c.exerciseId === exerciseId));
  }
}

@Injectable({ providedIn: 'root' })
export class GameRepository extends ContentRepository<GameDefinition> {
  protected readonly table = inject(DECKFIT_DB).games;
  protected readonly schema = GameDefinitionSchema;
  protected readonly label = 'Game';
}

@Injectable({ providedIn: 'root' })
export class RoutineRepository {
  private readonly table = inject(DECKFIT_DB).routines;

  get(id: string): Promise<Routine | undefined> {
    return this.table.get(id);
  }

  /** Most recently edited first. */
  list(): Promise<Routine[]> {
    return this.table.orderBy('updatedAt').reverse().toArray();
  }

  async favorites(): Promise<Routine[]> {
    return (await this.list()).filter((r) => r.favorite);
  }

  async save(routine: Routine): Promise<Routine> {
    const parsed = RoutineSchema.parse({ ...routine, updatedAt: Date.now() });
    await this.table.put(parsed);
    return parsed;
  }

  delete(id: string): Promise<void> {
    return this.table.delete(id);
  }
}

@Injectable({ providedIn: 'root' })
export class SessionRepository {
  private readonly table = inject(DECKFIT_DB).sessions;

  get(id: string): Promise<Session | undefined> {
    return this.table.get(id);
  }

  async exists(id: string): Promise<boolean> {
    return (await this.table.where('id').equals(id).count()) > 0;
  }

  /** Newest first. */
  list(limit?: number): Promise<Session[]> {
    const q = this.table.orderBy('startedAt').reverse();
    return (limit === undefined ? q : q.limit(limit)).toArray();
  }

  async save(session: Session): Promise<Session> {
    const parsed = SessionSchema.parse(session);
    await this.table.put(parsed);
    return parsed;
  }

  delete(id: string): Promise<void> {
    return this.table.delete(id);
  }
}

/** Typed meta keys. Add a key here before reading or writing it. */
export interface MetaValues {
  contentVersion: string;
  disclaimerAcceptedAt: number;
  deviceId: string;
  displayName: string;
  /** Device preferences (§8 settings); see core/settings/preferences.service.ts. */
  theme: 'system' | 'light' | 'dark';
  beeps: boolean;
  speech: boolean;
  /** When the install banner was waved away (0 = offer it again). */
  installDismissedAt: number;
}

@Injectable({ providedIn: 'root' })
export class MetaRepository {
  private readonly table = inject(DECKFIT_DB).meta;

  async get<K extends keyof MetaValues>(key: K): Promise<MetaValues[K] | undefined> {
    return (await this.table.get(key))?.value as MetaValues[K] | undefined;
  }

  async set<K extends keyof MetaValues>(key: K, value: MetaValues[K]): Promise<void> {
    await this.table.put({ key, value });
  }
}
