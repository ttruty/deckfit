import { Injectable, inject } from '@angular/core';
import { DeckRepository, ExerciseRepository, GameRepository } from '../../core/db/repositories';
import type { GameStart, RoomRoutine } from '../../core/sync/net-message';
import type { LobbyPlayer } from '../../core/sync/room-session';
import { applyDeckFilters } from '../../domain/models/deck-rules';

/**
 * Builds a room's GameStart on the host: game, deck (filters applied), and exercises come from
 * the room routine's bundle first, then this device's library for built-ins. Everyone else
 * plays from the payload, so joiners need nothing installed.
 */
@Injectable({ providedIn: 'root' })
export class RoomStartService {
  private readonly games = inject(GameRepository);
  private readonly decks = inject(DeckRepository);
  private readonly exercises = inject(ExerciseRepository);

  async build(room: RoomRoutine, players: readonly LobbyPlayer[], seed?: number): Promise<GameStart> {
    const { routine, bundle } = room;
    const game = bundle.games.find((g) => g.id === routine.gameId) ?? (await this.games.get(routine.gameId));
    const deck = bundle.decks.find((d) => d.id === routine.deckId) ?? (await this.decks.get(routine.deckId));
    if (!game || !deck) throw new Error('This routine’s game or deck is missing on the host device.');

    const ids = [...new Set(deck.cards.flatMap((c) => (c.exerciseId ? [c.exerciseId] : [])))];
    const local = await this.exercises.getMany(ids.filter((id) => !bundle.exercises.some((e) => e.id === id)));
    const exercises = [...bundle.exercises.filter((e) => ids.includes(e.id)), ...local.flatMap((e) => (e ? [e] : []))];
    const byId = new Map(exercises.map((e) => [e.id, e]));

    return {
      seed: seed ?? crypto.getRandomValues(new Uint32Array(1))[0],
      players: players.map((p, seat) => ({ id: p.id, name: p.name, seat })),
      game,
      deck: { id: deck.id, name: deck.name, suits: deck.suits, cards: applyDeckFilters(deck.cards, byId, routine.deckFilters) },
      settings: routine.settings,
      exercises,
    };
  }
}
