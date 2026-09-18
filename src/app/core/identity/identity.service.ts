import { Injectable, inject } from '@angular/core';
import type { SessionPlayer } from '../../domain/models/schemas';
import { newId } from '../db/deckfit-db';
import { MetaRepository } from '../db/repositories';

const DEFAULT_NAME = 'You';

/** Anonymous device identity (§1 non-goals: no accounts). Created on first use, kept in `meta`. */
@Injectable({ providedIn: 'root' })
export class IdentityService {
  private readonly meta = inject(MetaRepository);
  private cached: Promise<SessionPlayer> | null = null;

  me(): Promise<SessionPlayer> {
    return (this.cached ??= this.load());
  }

  async rename(name: string): Promise<void> {
    const trimmed = name.trim().slice(0, 30) || DEFAULT_NAME;
    await this.meta.set('displayName', trimmed);
    this.cached = null;
  }

  private async load(): Promise<SessionPlayer> {
    let id = await this.meta.get('deviceId');
    if (!id) {
      id = newId('device');
      await this.meta.set('deviceId', id);
    }
    return { id, name: (await this.meta.get('displayName')) ?? DEFAULT_NAME };
  }
}
