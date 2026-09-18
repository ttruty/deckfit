import { createDslRules } from '../../domain/engine/dsl/interpreter';
import { createContext, createInitialState, type EngineContext } from '../../domain/engine/reducer';
import type { GameState } from '../../domain/engine/state';
import type { GameStart } from './net-message';

/**
 * Builds the engine from a room's `start` payload. Host and every client call this with the
 * same payload, so they begin from identical state (verified by the first stateHash).
 */
export function createGame(start: GameStart): { ctx: EngineContext; initial: GameState } {
  const players = [...start.players].sort((a, b) => a.seat - b.seat).map((p) => p.id);
  return {
    ctx: createContext(start.deck, start.exercises, start.settings, createDslRules(start.game)),
    initial: createInitialState({ players, seed: start.seed, deck: start.deck }),
  };
}
