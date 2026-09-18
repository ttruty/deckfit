import type { GameDefinition } from '../../models/game.schema';
import type { Deck, Exercise, GameSettings } from '../../models/schemas';
import type { EngineEvent } from '../events';
import type { Intent } from '../intents';
import { createContext, createInitialState, getZone, pendingTasks, reduce, type EngineContext } from '../reducer';
import type { GameState } from '../state';
import { activeBettors, bettingOf, createDslRules, currentPlayer, hasActed, openClaim, requiredRank } from './interpreter';

export interface SimulationResult {
  state: GameState;
  events: EngineEvent[];
  intents: Intent[];
  /** Turn-driving intents sent: flips, plays, and passes. */
  turns: number;
}

/**
 * Plays a game with scripted, deterministic players. Each step it does the first that applies:
 * 1. complete the first pending task (assignment order);
 * 2. let the first running timer elapse;
 * 3. action games: the first player (seat order) with a card that `play` accepts plays it
 *    (hand order); otherwise players `pass` in rotation;
 *    betting: the current player calls a stake up to 8 (else folds); with nothing to call,
 *    raises by 2 while their stake is under 4 (else checks);
 *    bluff: the current player calls an open claim of 2+ cards, or one that is impossible given
 *    their own hand (claimed count + their cards of that rank > 4); otherwise claims every card of
 *    the required rank (jokers too, up to the limit), or bluffs with their lowest card;
 * 4. simultaneous turns: the first player (seat order) who hasn't acted flips;
 * 5. sequential turns: the current player flips.
 * Used by golden-log tests and the builder's dry run (§6.4). Throws if a scripted intent that
 * must succeed is rejected (a well-formed game never rejects this script).
 */
export function simulate(opts: {
  def: GameDefinition;
  deck: Pick<Deck, 'cards'>;
  exercises: readonly Pick<Exercise, 'id' | 'measure'>[];
  settings: GameSettings;
  seed: number;
  players?: string[];
  maxTurns?: number;
  /** Safety stop for user-built games: at most this many intents in total. */
  maxIntents?: number;
}): SimulationResult {
  const { def } = opts;
  const players = opts.players ?? Array.from({ length: def.players.min }, (_, i) => `p${i + 1}`);
  const ctx: EngineContext = createContext(opts.deck, opts.exercises, opts.settings, createDslRules(def));
  const maxTurns = opts.maxTurns ?? 500;
  const maxIntents = opts.maxIntents ?? Number.POSITIVE_INFINITY;

  let state = createInitialState({ players, seed: opts.seed, deck: opts.deck });
  const events: EngineEvent[] = [];
  const intents: Intent[] = [];
  let turns = 0;
  let passIndex = 0;

  /** Applies an intent; returns false (and records nothing) if it was rejected. */
  const attempt = (intent: Intent): boolean => {
    const step = reduce(state, intent, ctx);
    if (step.events.some((e) => e.type === 'IntentRejected')) return false;
    intents.push(intent);
    events.push(...step.events);
    state = step.state;
    return true;
  };
  const dispatch = (intent: Intent) => {
    if (!attempt(intent)) {
      const rejected = reduce(state, intent, ctx).events.find((e) => e.type === 'IntentRejected');
      throw new Error(`simulate: ${intent.type} rejected (${JSON.stringify(rejected)})`);
    }
  };

  dispatch({ type: 'deal', playerId: players[0] });
  while (state.phase === 'playing' && turns < maxTurns && intents.length < maxIntents) {
    const [task] = pendingTasks(state);
    const [timer] = state.timers;
    if (task) {
      dispatch({ type: 'completeTask', playerId: task.playerId, taskId: task.id });
      continue;
    }
    if (timer) {
      dispatch({ type: 'timerElapsed', playerId: players[0], timerId: timer.id });
      continue;
    }
    const bet = bettingOf(state);
    if (bet.active) {
      turns++;
      const p = currentPlayer(state);
      const stake = bet.stakes[p] ?? 0;
      if (bet.current > stake) dispatch(bet.current <= 8 ? { type: 'call', playerId: p } : { type: 'pass', playerId: p });
      else if (stake < 4 && activeBettors(state).length > 1) dispatch({ type: 'bet', playerId: p, amount: bet.current + 2 });
      else dispatch({ type: 'pass', playerId: p });
      continue;
    }
    if (def.bluff) {
      turns++;
      const p = currentPlayer(state);
      const open = openClaim(state);
      const hand = getZone(state, `hand:${p}`);
      if (open && open.by !== p) {
        const mine = hand.filter((id) => ctx.cardsById.get(id)!.rank === open.rank).length;
        if (open.count >= 2 || open.count + mine > 4) {
          dispatch({ type: 'call', playerId: p });
          continue;
        }
      }
      const rank = requiredRank(state);
      const byId = ctx.cardsById;
      const matching = hand.filter((id) => byId.get(id)!.rank === rank || byId.get(id)!.suit === 'joker').slice(0, def.bluff.maxCards);
      const order = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'JOKER'];
      const lowest = [...hand].sort((a, b) => order.indexOf(byId.get(a)!.rank) - order.indexOf(byId.get(b)!.rank))[0];
      if (!matching.length && !lowest) break;
      dispatch({ type: 'claim', playerId: p, cardIds: matching.length ? matching : [lowest] });
      continue;
    }
    if (def.actions?.play || def.actions?.pass) {
      turns++;
      const played = !!def.actions.play && players.some((p) =>
        getZone(state, `hand:${p}`).some((cardId) => attempt({ type: 'play', playerId: p, cardId })));
      if (played) continue;
      if (!def.actions.pass) break;
      dispatch({ type: 'pass', playerId: players[passIndex++ % players.length] });
      continue;
    }
    if (def.turn && 'mode' in def.turn) {
      const next = players.find((p) => !hasActed(state, p))!;
      dispatch({ type: 'flip', playerId: next });
      turns++;
      continue;
    }
    dispatch({ type: 'flip', playerId: currentPlayer(state) });
    turns++;
  }
  return { state, events, intents, turns };
}
