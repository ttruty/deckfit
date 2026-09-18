import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { GamesFileSchema } from '../../domain/models/game.schema';
import { DecksFileSchema, ExercisesFileSchema } from '../../domain/models/schemas';
import { DECKFIT_DB } from '../db/deckfit-db';
import { seedContent, type ContentBundle, type SeedResult } from '../db/seed-content';

/**
 * Loads assets/content/*.json (prefetched by the service worker) and seeds Dexie.
 * Runs at startup; after the first successful seed the app reads only from Dexie.
 */
@Injectable({ providedIn: 'root' })
export class ContentSeedService {
  private readonly http = inject(HttpClient);
  private readonly db = inject(DECKFIT_DB);

  async ensureSeeded(): Promise<SeedResult> {
    const [exercises, decks, games] = await Promise.all([
      this.load('exercises.json', ExercisesFileSchema),
      this.load('decks.json', DecksFileSchema),
      this.load('games.json', GamesFileSchema),
    ]);
    const bundle: ContentBundle = { exercises, decks, games };
    return seedContent(this.db, bundle);
  }

  private async load<T>(file: string, schema: { parse(x: unknown): T }): Promise<T> {
    return schema.parse(await firstValueFrom(this.http.get<unknown>(`assets/content/${file}`)));
  }
}
