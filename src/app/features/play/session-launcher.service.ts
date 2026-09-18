import { Injectable, inject } from '@angular/core';
import { newId } from '../../core/db/deckfit-db';
import { DeckRepository, ExerciseRepository, GameRepository, SessionRepository } from '../../core/db/repositories';
import { IdentityService } from '../../core/identity/identity.service';
import { Clock } from '../../core/time/clock.service';
import { resolveSettings } from '../../domain/engine/dsl/settings';
import { applyDeckFilters, type DeckFilters } from '../../domain/models/deck-rules';
import type { GameSettings, Routine, Session } from '../../domain/models/schemas';

export class LaunchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LaunchError';
  }
}

export interface LaunchOptions {
  deckId: string;
  gameId: string;
  settings?: Partial<GameSettings>;
  deckFilters?: DeckFilters;
  routineId?: string;
}

export const QUICK_START: LaunchOptions = { deckId: 'deck-bodyweight', gameId: 'solo-deal' };

/** Creates a Session (deck snapshot + resolved settings + seed) that /play/:id then runs. */
@Injectable({ providedIn: 'root' })
export class SessionLauncher {
  private readonly decks = inject(DeckRepository);
  private readonly games = inject(GameRepository);
  private readonly exercises = inject(ExerciseRepository);
  private readonly sessions = inject(SessionRepository);
  private readonly identity = inject(IdentityService);
  private readonly clock = inject(Clock);

  /** Returns the new session id. Throws LaunchError with a user-facing message. */
  async start(opts: LaunchOptions): Promise<string> {
    const [deck, game, me] = await Promise.all([this.decks.get(opts.deckId), this.games.get(opts.gameId), this.identity.me()]);
    if (!deck) throw new LaunchError('That deck no longer exists.');
    if (!game) throw new LaunchError('That game no longer exists.');

    const settings = resolveSettings(game, opts.settings);
    const exerciseIds = [...new Set(deck.cards.flatMap((c) => (c.exerciseId ? [c.exerciseId] : [])))];
    const found = await this.exercises.getMany(exerciseIds);
    const exercisesById = new Map(found.flatMap((e) => (e ? [[e.id, e] as const] : [])));
    const cards = applyDeckFilters(deck.cards, exercisesById, opts.deckFilters);
    if (!cards.some((c) => c.exerciseId)) throw new LaunchError('No exercise cards left after the deck filters.');

    const session: Session = {
      id: newId('session'),
      ...(opts.routineId ? { routineId: opts.routineId } : {}),
      seed: randomSeed(),
      startedAt: this.clock.epoch(),
      game: { id: game.id, name: game.name },
      deck: { id: deck.id, name: deck.name, suits: deck.suits, cards },
      settings,
      players: [me],
      log: [],
      totals: { [me.id]: {} },
    };
    await this.sessions.save(session);
    return session.id;
  }

  startRoutine(routine: Routine): Promise<string> {
    return this.start({
      deckId: routine.deckId,
      gameId: routine.gameId,
      settings: routine.settings,
      routineId: routine.id,
      ...(routine.deckFilters ? { deckFilters: routine.deckFilters } : {}),
    });
  }
}

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}
