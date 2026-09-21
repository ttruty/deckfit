import { Injectable, inject } from '@angular/core';
import { BundleService } from '../../core/db/bundle.service';
import { DeckRepository, ExerciseRepository, GameRepository } from '../../core/db/repositories';
import type { RoomRoutine } from '../../core/sync/net-message';
import { resolveSettings } from '../../domain/engine/dsl/settings';
import { applyDeckFilters } from '../../domain/models/deck-rules';
import type { Intensity, Routine } from '../../domain/models/schemas';

/** Unsaved, built-in routines offered for rooms: one per group game, on the bodyweight deck. */
export const ROOM_DEFAULT_PREFIX = 'room-default-';
export const ROOM_DEFAULT_ROUTINE_ID = `${ROOM_DEFAULT_PREFIX}interval-deck`;

/** Turns a routine into the RoomRoutine that travels with a room (routine + bundle + preview). */
@Injectable({ providedIn: 'root' })
export class RoomRoutineService {
  private readonly decks = inject(DeckRepository);
  private readonly games = inject(GameRepository);
  private readonly exercises = inject(ExerciseRepository);
  private readonly bundles = inject(BundleService);

  /** Interval Deck on the bodyweight deck: a built-in group game that needs nothing saved. */
  async defaultRoutine(): Promise<Routine> {
    const [interval] = (await this.defaultRoutines()).filter((r) => r.id === ROOM_DEFAULT_ROUTINE_ID);
    if (!interval) throw new Error('Interval Deck is not installed');
    return interval;
  }

  /** One ready-to-play routine per built-in game that allows 2+ players (default settings, bodyweight deck). */
  async defaultRoutines(): Promise<Routine[]> {
    const games = (await this.games.listBuiltIn()).filter((g) => g.players.max >= 2).sort((a, b) => a.name.localeCompare(b.name));
    return games.map((game) => ({
      id: `${ROOM_DEFAULT_PREFIX}${game.id}`, name: game.name, deckId: 'deck-bodyweight', gameId: game.id,
      settings: resolveSettings(game), favorite: false, updatedAt: 0,
    }));
  }

  /** `intensity` overrides the routine's own (how /room/new offers low / moderate / high). */
  async build(source: Routine, opts: { intensity?: Intensity } = {}): Promise<RoomRoutine> {
    const routine: Routine = opts.intensity
      ? { ...source, settings: { ...source.settings, intensity: opts.intensity } }
      : source;
    const [deck, game] = await Promise.all([this.decks.get(routine.deckId), this.games.get(routine.gameId)]);
    if (!deck || !game) throw new Error('This routine’s deck or game is missing.');
    const saved = !routine.id.startsWith(ROOM_DEFAULT_PREFIX);
    const bundle = saved
      ? await this.bundles.exportBundle({ routineIds: [routine.id] })
      : { format: 'deckfit-bundle' as const, version: 1 as const, exportedAt: Date.now(), exercises: [], decks: [], games: [], routines: [routine] };

    const exerciseIds = [...new Set(deck.cards.flatMap((c) => (c.exerciseId ? [c.exerciseId] : [])))];
    const byId = new Map((await this.exercises.getMany(exerciseIds)).flatMap((e) => (e ? [[e.id, e] as const] : [])));
    return {
      routine,
      bundle,
      preview: {
        deckName: deck.name,
        gameName: game.name,
        gameSummary: game.summary,
        ...(game.howTo?.length ? { gameHowTo: game.howTo } : {}),
        players: game.players,
        cardCount: applyDeckFilters(deck.cards, byId, routine.deckFilters).length,
        suits: deck.suits.filter((s) => s.suit !== 'joker').map((s) => ({ suit: s.suit, label: s.label })),
      },
    };
  }
}
