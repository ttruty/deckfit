import { Injectable, Injector, inject } from '@angular/core';
import { ContentSeedService } from '../content/content-seed.service';
import { HabitsService } from '../habits/habits.service';
import { IdentityService } from '../identity/identity.service';
import { PreferencesService } from '../settings/preferences.service';
import { DECKFIT_DB } from './deckfit-db';

/** What an erase would take with it, so the confirmation can say the numbers (§10). */
export interface EraseSummary {
  workouts: number;
  decks: number;
  games: number;
  exercises: number;
  routines: number;
}

/** What actually happened, so the screen can be honest about the parts it couldn't reach. */
export interface EraseResult {
  /** Null when there was nothing to tell the backend about, else whether it accepted. */
  challenges: 'cleared' | 'kept' | null;
}

/**
 * Clearing this device out (§10). Two sizes:
 * - `clearHistory()` — the workout log only; the decks, games and routines you made stay.
 * - `eraseEverything()` — a factory reset: every table, the device's identity, its preferences,
 *   its Habits connection, and its rows in any shared challenge. Built-in content is seeded
 *   again, so the app is usable the moment it returns.
 *
 * Irreversible, and nothing here asks: the caller confirms (and offers an export) first.
 */
@Injectable({ providedIn: 'root' })
export class DataEraseService {
  private readonly db = inject(DECKFIT_DB);
  private readonly content = inject(ContentSeedService);
  private readonly identity = inject(IdentityService);
  private readonly prefs = inject(PreferencesService);
  private readonly habits = inject(HabitsService);
  private readonly injector = inject(Injector);

  async summary(): Promise<EraseSummary> {
    const [workouts, decks, games, exercises, routines] = await Promise.all([
      this.db.sessions.count(),
      this.db.decks.filter((d) => !d.builtIn).count(),
      this.db.games.filter((g) => !g.builtIn).count(),
      this.db.exercises.filter((e) => !e.builtIn).count(),
      this.db.routines.count(),
    ]);
    return { workouts, decks, games, exercises, routines };
  }

  /** Deletes every saved workout. Returns how many went. */
  async clearHistory(): Promise<number> {
    const count = await this.db.sessions.count();
    await this.db.sessions.clear();
    return count;
  }

  /**
   * Everything. The shared rows go first — once the device id is gone there is no way to say
   * which rows were this device's — and a backend that refuses (offline, no migration) doesn't
   * stop the local wipe; the result says what happened.
   */
  async eraseEverything(): Promise<EraseResult> {
    const challenges = await this.forgetChallenges();

    const tables = [this.db.exercises, this.db.decks, this.db.games, this.db.routines, this.db.sessions, this.db.meta];
    await this.db.transaction('rw', tables, () => Promise.all(tables.map((t) => t.clear())));

    // In-memory copies of what was just wiped, so nothing writes the old values back.
    this.identity.forget();
    this.habits.reset();
    this.prefs.reset();

    // The content version went with `meta`, so this reseeds the built-in decks, games and
    // exercises; the app is usable again without a reload.
    await this.content.ensureSeeded();
    return { challenges };
  }

  /**
   * Leaves every challenge and deletes the days this device reported. Loaded lazily, so
   * supabase-js stays out of every bundle but the one that needs it (§4).
   */
  private async forgetChallenges(): Promise<EraseResult['challenges']> {
    try {
      const { ChallengeService } = await import('../challenges/challenge.service');
      const challenges = this.injector.get(ChallengeService);
      if (!(await challenges.mine()).length) return null;
      await challenges.forget();
      return 'cleared';
    } catch {
      // Offline, no backend, or the tables aren't set up. The device still gets wiped; what is
      // on the server stays, and the caller says so.
      return 'kept';
    }
  }
}
