import type { EngineEvent } from '../../domain/engine/events';
import type { GameState } from '../../domain/engine/state';
import type { Session } from '../../domain/models/schemas';
import type { GameStart } from '../../core/sync/net-message';

/**
 * A finished room game as a History entry for this device (§10). Hidden games redact other
 * players' totals, so only `playerId`'s own work is complete — History only reads that player.
 */
export function roomSessionRecord(opts: {
  id: string;
  start: GameStart;
  state: GameState;
  playerId: string;
  roomId?: string | null;
  log: readonly EngineEvent[];
  startedAt: number;
  endedAt: number;
}): Session {
  const { start, state } = opts;
  return {
    id: opts.id,
    ...(opts.roomId ? { roomId: opts.roomId } : {}),
    playerId: opts.playerId,
    seed: start.seed,
    startedAt: opts.startedAt,
    endedAt: opts.endedAt,
    outcome: 'finished',
    game: { id: start.game.id, name: start.game.name },
    deck: start.deck,
    settings: start.settings,
    players: start.players.map((p) => ({ id: p.id, name: p.name })),
    log: [...opts.log],
    totals: state.totals,
  };
}
