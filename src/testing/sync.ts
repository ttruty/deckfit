import { filter, firstValueFrom, Observable } from 'rxjs';
import { resolveSettings } from '../app/domain/engine/dsl/settings';
import type { Bundle } from '../app/domain/models/bundle.schema';
import type { GameStart, NetMessage, RoomRoutine } from '../app/core/sync/net-message';
import type { PlayerId, PlayerInfo, PlayerPresence, RoomInfo, SyncTransport } from '../app/core/sync/sync-transport';
import { loadContent } from './db';

/** Lets loopback microtasks settle (several hops: request → host → broadcast). */
export async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
}

export async function waitFor<T>(source: Observable<T>, predicate: (v: T) => boolean): Promise<T> {
  return firstValueFrom(source.pipe(filter(predicate)));
}

/**
 * Wraps a transport and drops chosen incoming messages, to simulate an unreliable network
 * for one peer. `dropEventsSeq` drops `events` messages with those seqs (each once).
 */
export class LossyTransport implements SyncTransport {
  readonly dropEventsSeq = new Set<number>();
  readonly messages$: Observable<NetMessage>;
  readonly presence$: Observable<PlayerPresence[]>;

  constructor(private readonly inner: SyncTransport) {
    this.presence$ = inner.presence$;
    this.messages$ = inner.messages$.pipe(
      filter((m) => {
        if (m.kind === 'events' && this.dropEventsSeq.has(m.seq)) {
          this.dropEventsSeq.delete(m.seq);
          return false;
        }
        return true;
      }),
    );
  }

  createRoom(host: PlayerInfo): Promise<RoomInfo> {
    return this.inner.createRoom(host);
  }
  joinRoom(code: string, player: PlayerInfo): Promise<RoomInfo> {
    return this.inner.joinRoom(code, player);
  }
  send(msg: NetMessage, to?: PlayerId): void {
    this.inner.send(msg, to);
  }
  updatePlayer(player: PlayerInfo): void {
    this.inner.updatePlayer(player);
  }
  leave(): Promise<void> {
    return this.inner.leave();
  }
}

/** Room routine for the built-in interval-deck (1–6 players) on the bodyweight deck. */
export function intervalRoomRoutine(): RoomRoutine {
  const content = loadContent();
  const game = content.games.games.find((g) => g.id === 'interval-deck')!;
  const deck = content.decks.decks.find((d) => d.id === 'deck-bodyweight')!;
  const routine = {
    id: 'routine-room', name: 'Tabata at the park', deckId: deck.id, gameId: game.id,
    settings: resolveSettings(game, { rounds: 3 }), favorite: false, updatedAt: 1,
  };
  const bundle: Bundle = { format: 'deckfit-bundle', version: 1, exportedAt: 1, exercises: [], decks: [], games: [], routines: [routine] };
  return {
    routine, bundle,
    preview: {
      deckName: deck.name, gameName: game.name, gameSummary: game.summary, players: game.players, cardCount: deck.cards.length,
      suits: deck.suits.map((s) => ({ suit: s.suit, label: s.label })),
    },
  };
}

/** Start payload for the room routine above. */
export function intervalStart(players: PlayerInfo[], seed = 2026): GameStart {
  const content = loadContent();
  const { routine } = intervalRoomRoutine();
  const game = content.games.games.find((g) => g.id === routine.gameId)!;
  const deck = content.decks.decks.find((d) => d.id === routine.deckId)!;
  const ids = new Set(deck.cards.map((c) => c.exerciseId));
  return {
    seed,
    players: players.map((p, seat) => ({ ...p, seat })),
    game,
    deck: { id: deck.id, name: deck.name, suits: deck.suits, cards: deck.cards },
    settings: routine.settings,
    exercises: content.exercises.exercises.filter((e) => ids.has(e.id)),
  };
}

/**
 * Delays every incoming message by `delayMs` on a ManualScheduler, to simulate latency.
 * Advance the scheduler (and flush microtasks) to deliver.
 */
export class DelayedTransport implements SyncTransport {
  readonly messages$: Observable<NetMessage>;
  readonly presence$: Observable<PlayerPresence[]>;

  constructor(private readonly inner: SyncTransport, scheduler: { setTimeout(fn: () => void, ms: number): unknown }, delayMs: number) {
    this.presence$ = inner.presence$;
    this.messages$ = new Observable<NetMessage>((sub) => {
      const s = inner.messages$.subscribe((m) => scheduler.setTimeout(() => sub.next(m), delayMs));
      return () => s.unsubscribe();
    });
  }

  createRoom(host: PlayerInfo): Promise<RoomInfo> {
    return this.inner.createRoom(host);
  }
  joinRoom(code: string, player: PlayerInfo): Promise<RoomInfo> {
    return this.inner.joinRoom(code, player);
  }
  send(msg: NetMessage, to?: PlayerId): void {
    this.inner.send(msg, to);
  }
  updatePlayer(player: PlayerInfo): void {
    this.inner.updatePlayer(player);
  }
  leave(): Promise<void> {
    return this.inner.leave();
  }
}
