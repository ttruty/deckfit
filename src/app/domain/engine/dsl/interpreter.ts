/**
 * Interprets a GameDefinition (§6.2) as GameRules for the reducer.
 *
 * Flow:
 * - `deal` runs setup (filter → shuffle → deal steps) once.
 * - `flip` runs a turn. Sequential: the current player runs `turn.steps`. Simultaneous: each
 *   player's flip runs `turn.each` as that player; when everyone has acted, `turn.then` runs.
 * - `play` / `pass` run `actions.play|pass` as the sender, after their `require` checks.
 * - `timerElapsed` ends a timer phase or marks the timer elapsed.
 * - `end.when` is evaluated whenever no tasks are pending. With `end.then`, those steps run
 *   once first (e.g. assigning leftover cards) and GameOver follows when their tasks are done.
 *
 * Every step runs with an actor: the player whose `hand`/`pile` the step means.
 */
import type {
  AssignSpec, Comparison, Condition, DrawFilter, DslZone, GameDefinition, NumberRef, PlayerZones, Selector, Step as DslStep,
} from '../../models/game.schema';
import type { Card, GameSettings, MatchOn, Suit } from '../../models';
import { createRng } from '../../shuffle/rng';
import { shuffle } from '../../shuffle/shuffle';
import type { EngineEvent } from '../events';
import type { Intent } from '../intents';
import {
  assignAmount, assignTasks, chain, getZone, pendingTasks, reject, transferCards,
  type EngineContext, type GameRules, type Step,
} from '../reducer';
import { comparePoker, evaluatePoker } from '../poker';
import type { GameState, PlayerId, Task, ZoneId } from '../state';
import { settingValue } from './settings';

const MAX_REPEAT = 1000;
const RANK_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;

/** What a step needs besides state: the engine context, who is acting, and the intent (for `intent.card`). */
export interface Exec {
  ctx: EngineContext;
  actor: PlayerId;
  intent?: Intent;
  /** The game being run; steps that need game-level rules (e.g. the judge) read it from here. */
  def?: GameDefinition;
}

export function createDslRules(def: GameDefinition): GameRules {
  return {
    canActFor(state, actor, task, ctx) {
      return judgeOf(state, def, ctx.settings) === actor && task.playerId !== actor;
    },

    apply(state, intent, ctx) {
      const x: Exec = { ctx, actor: intent.playerId, intent, def };
      switch (intent.type) {
        case 'deal':
          if (state.phase !== 'setup') return reject(state, intent, 'already-dealt');
          return checkEnd(runSetup(def, state, { ctx, actor: currentPlayer(state), def }), def, ctx);

        case 'flip': {
          if (state.phase === 'setup') return reject(state, intent, 'not-dealt');
          if (state.vars[ENDING]) return reject(state, intent, 'game-ending');
          if (state.vars[BET_ACTIVE]) return reject(state, intent, 'betting-open');
          if (!def.turn) return reject(state, intent, 'not-supported');
          if (pendingTasks(state).length) return reject(state, intent, 'tasks-pending');
          if ('steps' in def.turn) {
            if (currentPlayer(state) !== intent.playerId) return reject(state, intent, 'not-your-turn');
            const started = def.race ? startRaceRound(state) : state;
            return checkEnd(runSteps({ state: started, events: [] }, def.turn.steps, ctx, x), def, ctx);
          }
          // Simultaneous: each player acts once per round.
          if (state.vars[actedVar(intent.playerId)]) return reject(state, intent, 'already-acted');
          const turn = def.turn;
          let step = runSteps({ state, events: [] }, turn.each, ctx, x);
          step = { ...step, state: setVar(step.state, actedVar(intent.playerId), true) };
          step = closeSimultaneousRound(def, step, ctx);
          return checkEnd(step, def, ctx);
        }

        case 'bet':
        case 'call':
          if (def.bluff && intent.type === 'call') return challenge(def, state, intent, x);
          if (!def.betting) return reject(state, intent, 'not-supported');
          if (!state.vars[BET_ACTIVE]) return reject(state, intent, 'not-betting');
          return betting(def, state, intent, x);

        case 'claim':
          if (!def.bluff) return reject(state, intent, 'not-supported');
          return claim(def, state, intent, x);

        case 'play':
        case 'pass': {
          if (intent.type === 'pass' && state.vars[BET_ACTIVE]) return betting(def, state, intent, x);
          const action = def.actions?.[intent.type];
          if (!action) return reject(state, intent, 'not-supported');
          if (state.phase === 'setup') return reject(state, intent, 'not-dealt');
          if (state.vars[ENDING]) return reject(state, intent, 'game-ending');
          if (pendingTasks(state, intent.playerId).length) return reject(state, intent, 'tasks-pending');
          if (intent.type === 'play') {
            if (!ctx.cardsById.has(intent.cardId) || !getZone(state, `hand:${intent.playerId}`).includes(intent.cardId)) {
              return reject(state, intent, 'not-in-hand');
            }
          }
          for (const r of action.require ?? []) if (!evaluate(r.when, state, ctx, x)) return reject(state, intent, r.reason);
          return checkEnd(runSteps({ state, events: [] }, action.steps, ctx, x), def, ctx);
        }

        case 'timerElapsed': {
          const timer = state.timers.find((t) => t.id === intent.timerId);
          if (!timer) return reject(state, intent, 'unknown-timer');
          if (timer.kind === 'interval' && timer.phase === 'work' && timer.restSec) {
            // Work is over: the same timer continues as rest. Not "elapsed" until rest ends.
            const rest = { ...timer, phase: 'rest' as const, durationSec: timer.restSec };
            return {
              state: { ...state, timers: state.timers.map((t) => (t.id === timer.id ? rest : t)) },
              events: [{ type: 'TimerElapsed', timerId: timer.id, phase: 'work' }, { type: 'TimerStarted', timer: rest }],
            };
          }
          const next: GameState = {
            ...state,
            timers: state.timers.filter((t) => t.id !== intent.timerId),
            vars: { ...state.vars, [elapsedVar(intent.timerId)]: true },
          };
          const elapsed = { type: 'TimerElapsed' as const, timerId: intent.timerId, ...(timer.phase ? { phase: timer.phase } : {}) };
          return checkEnd({ state: next, events: [elapsed] }, def, ctx);
        }

        default:
          return reject(state, intent, 'not-supported');
      }
    },

    afterLeave(state, ctx) {
      // The players still in may already have acted, or be waiting on tasks that are now skipped.
      let step: Step = { state, events: [] };
      if (def.turn && 'mode' in def.turn && !pendingTasks(step.state).length) step = closeSimultaneousRound(def, step, ctx);
      return checkEnd(step, def, ctx);
    },

    afterTask(state, ctx, task) {
      let step: Step = { state, events: [] };
      if (def.race && task.status === 'done') step = decideRace(state, task.playerId);
      return checkEnd(step, def, ctx);
    },
  };
}

/**
 * The player judging this round, or null. Judges rotate by round through the players still in the
 * game: round 1 is the first seat. A judge gets no tasks and may mark anyone else's task done.
 */
export function judgeOf(state: GameState, def: GameDefinition | undefined, settings: GameSettings): PlayerId | null {
  if (!def?.judge) return null;
  const enabled = settingValue<boolean>(def.judge, settings) === true;
  const order = state.turn.order;
  if (!enabled || order.length < 2) return null;
  const round = Math.max(1, counter(state, 'round') || state.turn.round + 1);
  return order[(round - 1) % order.length];
}

/** Runs a simultaneous round's `then` once everyone still in the game has acted. */
function closeSimultaneousRound(def: GameDefinition, step: Step, ctx: EngineContext): Step {
  const turn = def.turn;
  if (!turn || !('mode' in turn)) return step;
  const playing = step.state.turn.order;
  if (!playing.length || !playing.every((id) => step.state.vars[actedVar(id)])) return step;
  const cleared = step.state.players.reduce((s, p) => unsetVar(s, actedVar(p.id)), step.state);
  const started = def.race ? startRaceRound(cleared) : cleared;
  return runSteps({ state: started, events: step.events }, turn.then, ctx, { ctx, actor: currentPlayer(started), def });
}

// ── Setup, race, end ────────────────────────────────────────────────────────

function runSetup(def: GameDefinition, state: GameState, x: Exec): Step {
  const { ctx } = x;
  let s: GameState = { ...state, phase: 'playing' };
  if (def.teams) s = setVar(s, TEAM_SIZE, def.teams.size);
  const events: Step['events'] = [{ type: 'GameStarted', players: state.players.map((p) => p.id) }];

  const suits = def.setup.filter ? settingValue<Suit[]>(def.setup.filter.suits, ctx.settings) : undefined;
  if (suits) s = { ...s, zones: { ...s.zones, draw: s.zones.draw.filter((id) => suits.includes(card(ctx, id).suit)) } };

  if (def.setup.shuffle) {
    const rng = createRng(s.rngState);
    s = { ...s, zones: { ...s.zones, draw: shuffle(s.zones.draw, rng) }, rngState: rng.state };
    events.push({ type: 'CardsShuffled', zone: 'draw', count: s.zones.draw.length });
  }
  return runSteps({ state: s, events }, def.setup.deal, ctx, x);
}

/** A race round covers tasks created from now on; nobody has won it yet. */
function startRaceRound(state: GameState): GameState {
  return unsetVar(setVar(state, RACE_FIRST_TASK, state.nextId), RACE_WINNER);
}

/** The first player with every one of this round's tasks done (none skipped) wins the round. */
function decideRace(state: GameState, playerId: PlayerId): Step {
  if (state.vars[RACE_WINNER]) return { state, events: [] };
  const first = typeof state.vars[RACE_FIRST_TASK] === 'number' ? (state.vars[RACE_FIRST_TASK] as number) : 0;
  const mine = state.tasks.filter((t) => t.playerId === playerId && taskNumber(t) >= first);
  if (!mine.length || !mine.every((t) => t.status === 'done')) return { state, events: [] };
  const round = roundNumber(state);
  const next = addWin(setVar(state, RACE_WINNER, playerId), playerId);
  return { state: next, events: [{ type: 'RoundWon', playerId, round }] };
}

function checkEnd(step: Step, def: GameDefinition, ctx: EngineContext): Step {
  const { state } = step;
  if (state.phase !== 'playing' || pendingTasks(state).length || state.vars[BET_ACTIVE]) return step;
  if (!state.vars[ENDING]) {
    if (!evaluate(def.end.when, state, ctx)) return step;
    if (def.end.then?.length) {
      const ending = setVar(state, ENDING, true);
      const after = runSteps({ state: ending, events: step.events }, def.end.then, ctx, { ctx, actor: currentPlayer(ending), def });
      if (pendingTasks(after.state).length) return after;
      return gameOver(after, def, ctx);
    }
  }
  return gameOver(step, def, ctx);
}

function gameOver(step: Step, def: GameDefinition, ctx: EngineContext): Step {
  const scores = score(step.state, def, ctx);
  return {
    state: { ...step.state, phase: 'finished', timers: [], scores },
    events: [...step.events, { type: 'GameOver', reason: 'end', scores }],
  };
}

/** total-work: 1 point per rep, 1 per 5 seconds. rounds-won: 1 point per round won. */
function score(state: GameState, def: GameDefinition, ctx: EngineContext): Record<PlayerId, number> {
  return Object.fromEntries(
    state.players.map(({ id }) => {
      if (def.scoring === 'rounds-won') return [id, typeof state.vars[winsVar(id)] === 'number' ? (state.vars[winsVar(id)] as number) : 0];
      const totals = state.totals[id] ?? {};
      const points = Object.entries(totals).reduce((sum, [key, amount]) => {
        const measure = key === 'wild' ? 'reps' : key === 'bonus-cardio' ? 'seconds' : ctx.exercisesById.get(key)?.measure;
        return sum + (measure === 'seconds' ? Math.round(amount / 5) : amount);
      }, 0);
      return [id, points];
    }),
  );
}

// ── Steps ───────────────────────────────────────────────────────────────────

/** Runs steps in order. `x` defaults to the current player acting (backwards compatible). */
export function runSteps(step: Step, steps: readonly DslStep[], ctx: EngineContext, x?: Exec): Step {
  const exec = x ?? { ctx, actor: currentPlayer(step.state) };
  return steps.reduce((acc, s) => chain(acc, (state) => runStep(state, s, exec)), step);
}

function runStep(state: GameState, step: DslStep, x: Exec): Step {
  const { ctx } = x;
  const none: Step = { state, events: [] };

  if ('deal' in step) {
    const count = num(step.deal.count, ctx.settings, state);
    if (!count) return none;
    const to = step.deal.to;
    if (to === 'hands' || to === 'piles' || to === 'teams') {
      const faceUp = step.deal.faceUp ?? to === 'piles';
      let s = state;
      const events: EngineEvent[] = [];
      const recipients = to === 'teams' ? teamCaptains(s) : s.turn.order;
      const dealt = new Map<PlayerId, string[]>(recipients.map((p) => [p, []]));
      for (let i = 0; i < count; i++) {
        for (const p of recipients) {
          const zone = `${to === 'piles' ? 'pile' : 'hand'}:${p}` as ZoneId;
          const drawn = drawOne(s, ctx, step.deal.only);
          s = drawn.state;
          events.push(...drawn.events);
          if (drawn.cardId === undefined) break;
          s = transferCards(s, 'draw', zone, [drawn.cardId], faceUp);
          dealt.get(p)!.push(drawn.cardId);
        }
      }
      for (const [p, cardIds] of dealt) {
        if (cardIds.length) events.push({ type: 'CardsDealt', zone: `${to === 'piles' ? 'pile' : 'hand'}:${p}` as ZoneId, cardIds, faceUp });
      }
      return { state: s, events };
    }
    return dealFromDraw(state, zoneId(to, x, state), count, step.deal.faceUp ?? to === 'table', ctx, step.deal.only);
  }

  if ('flip' in step) {
    const drawn = drawOne(state, ctx, step.flip.only);
    if (drawn.cardId === undefined) return { state: drawn.state, events: drawn.events };
    const zone = zoneId(step.flip.to ?? 'table', x, state);
    return {
      state: transferCards(drawn.state, 'draw', zone, [drawn.cardId], true),
      events: [...drawn.events, { type: 'CardFlipped', zone, cardId: drawn.cardId }],
    };
  }

  if ('move' in step) {
    const to = zoneId(step.to, x, state);
    let s = state;
    const events: EngineEvent[] = [];
    for (const [from, ids] of groupBySourceZone(selectWithZones(state, toArray(step.move), x))) {
      if (from === to || ids.length === 0) continue;
      s = transferCards(s, from, to, ids, step.faceUp);
      events.push({ type: 'CardsMoved', from, to, cardIds: ids });
    }
    return { state: s, events };
  }

  if ('refill' in step) {
    const target = num(step.refill.to, ctx.settings, state);
    const zone = zoneId(step.refill.zone, x, state);
    const need = target === undefined ? 0 : target - getZone(state, zone).length;
    return need > 0 ? dealFromDraw(state, zone, need, step.refill.faceUp ?? zone === 'table', ctx, step.refill.only) : none;
  }

  if ('assign' in step) return runAssign(state, typeof step.assign === 'object' && !Array.isArray(step.assign) ? step.assign : { cards: step.assign }, x);

  if ('incr' in step) {
    const by = step.by === undefined ? 1 : (num(step.by, ctx.settings, state) ?? 0);
    return { state: setVar(state, counterVar(step.incr), counter(state, step.incr) + by), events: [] };
  }

  if ('reset' in step) return { state: unsetVar(state, counterVar(step.reset)), events: [] };

  if ('winners' in step) {
    const w = step.winners;
    if ('wins' in w) return runWinners(state, w.cards, w.wins, x);
    if ('by' in w && w.by === 'poker') return pokerWinners(state, w.cards, x);
    return emptyTeamWinners(state);
  }

  if ('reshuffle' in step) {
    const rng = createRng(state.rngState);
    const draw = shuffle([...state.zones.draw, ...state.zones.discard], rng);
    const faceUp = state.faceUp.filter((id) => !state.zones.discard.includes(id));
    return {
      state: { ...state, zones: { ...state.zones, draw, discard: [] }, faceUp, rngState: rng.state },
      events: [{ type: 'CardsShuffled', zone: 'draw', count: draw.length }],
    };
  }

  if ('reveal' in step) {
    // Folded players' cards are never revealed.
    const ids = selectWithZones(state, toArray(step.reveal), x)
      .filter(({ zone }) => { const owner = ownerOf(zone); return !owner || !state.vars[foldedVar(owner)]; })
      .map((c) => c.id)
      .filter((id) => !state.faceUp.includes(id));
    if (!ids.length) return none;
    return { state: { ...state, faceUp: [...state.faceUp, ...ids] }, events: [{ type: 'CardsRevealed', cardIds: ids }] };
  }

  if ('startBetting' in step) {
    let s = clearBetting(state);
    s = setVar(setVar(setVar(s, BET_ACTIVE, true), BET_POT, 0), BET_CURRENT, 0);
    return { state: s, events: [] };
  }

  if ('assignPot' in step) return assignPotToLosers(state, x);

  if ('timer' in step) {
    const seconds = num(step.timer.seconds, ctx.settings, state);
    if (!seconds) return none; // unset optional setting (e.g. no time cap) → no timer
    const { id, kind, label } = step.timer;
    const restSec = kind === 'interval' && step.timer.restSeconds !== undefined ? num(step.timer.restSeconds, ctx.settings, state) : undefined;
    const timer = {
      id, kind, durationSec: seconds,
      ...(kind === 'interval' ? { phase: 'work' as const } : {}),
      ...(restSec ? { restSec } : {}),
      ...(label === undefined ? {} : { label }),
    };
    // Re-starting a timer id replaces the running one.
    return {
      state: { ...unsetVar(state, elapsedVar(id)), timers: [...state.timers.filter((t) => t.id !== id), timer] },
      events: [{ type: 'TimerStarted', timer }],
    };
  }

  if ('turn' in step) {
    const { order, index, round } = state.turn;
    const nextIndex = (index + 1) % order.length;
    const nextRound = nextIndex === 0 ? round + 1 : round;
    return {
      state: { ...state, turn: { ...state.turn, index: nextIndex, round: nextRound } },
      events: [{ type: 'TurnStarted', playerId: order[nextIndex], round: nextRound }],
    };
  }

  if ('if' in step) {
    const branch = evaluate(step.if, state, ctx, x) ? step.then : (step.else ?? []);
    return runSteps(none, branch, ctx, x);
  }

  if ('repeat' in step) {
    const times = Math.min(num(step.repeat, ctx.settings, state) ?? 0, MAX_REPEAT);
    let acc = none;
    for (let i = 0; i < times; i++) acc = runSteps(acc, step.steps, ctx, x);
    return acc;
  }

  return assertNever(step);
}

function runAssign(state: GameState, spec: AssignSpec, x: Exec): Step {
  const { ctx } = x;
  const picked = selectWithZones(state, toArray(spec.cards), x);
  if (!picked.length) return { state, events: [] };
  const timedSeconds = spec.timedSec === undefined ? undefined : num(spec.timedSec, ctx.settings, state);
  const opts = timedSeconds ? { timedSeconds } : {};
  const ids = picked.map((p) => p.id);

  // Who gets which cards, in seat order so task ids stay deterministic.
  let plan: [PlayerId, string[]][];
  switch (spec.to ?? 'current') {
    case 'current':
      plan = [[x.actor, ids]];
      break;
    case 'each': {
      // The round's judge (if any) sits this one out: they count for everyone else.
      const judge = judgeOf(state, x.def, x.ctx.settings);
      plan = state.turn.order.filter((p) => p !== judge).map((p) => [p, ids]);
      break;
    }
    case 'winners':
    case 'losers': {
      const winners = winnersOf(state);
      const wanted = spec.to === 'winners';
      plan = state.turn.order.filter((p) => winners.includes(p) === wanted).map((p) => [p, ids]);
      break;
    }
    case 'owner':
      plan = state.turn.order
        .map((p): [PlayerId, string[]] => [p, picked.filter((c) => ownerOf(c.zone) === p || (!ownerOf(c.zone) && p === x.actor)).map((c) => c.id)])
        .filter(([, cards]) => cards.length > 0);
      break;
  }
  return plan.reduce((acc, [p, cards]) => chain(acc, (s) => assignTasks(s, p, cards, ctx, opts)), { state, events: [] } as Step);
}

/**
 * Highest (or lowest) rank among each player's first selected card wins; ties at the top all win.
 * If everyone with a card ties (2+ players), nobody wins. Jokers never win. Emits RoundWon per winner.
 */
function runWinners(state: GameState, selector: Selector, wins: 'high' | 'low', x: Exec): Step {
  const byPlayer = new Map<PlayerId, number>();
  for (const { id, zone } of selectWithZones(state, [selector], x)) {
    const owner = ownerOf(zone);
    if (!owner || byPlayer.has(owner)) continue;
    byPlayer.set(owner, rankIndex(card(x.ctx, id)));
  }
  const ranked = [...byPlayer].filter(([, r]) => r >= 0);
  const best = ranked.length ? (wins === 'high' ? Math.max(...ranked.map(([, r]) => r)) : Math.min(...ranked.map(([, r]) => r))) : undefined;
  let winners = best === undefined ? [] : ranked.filter(([, r]) => r === best).map(([p]) => p);
  if (winners.length >= 2 && winners.length === byPlayer.size) winners = [];
  const ordered = state.turn.order.filter((p) => winners.includes(p));

  const round = roundNumber(state);
  let s = setVar(state, WINNERS, ordered.join(','));
  for (const p of ordered) s = addWin(s, p);
  return { state: s, events: ordered.map((playerId) => ({ type: 'RoundWon' as const, playerId, round })) };
}

/** Draws the top card, sending cards that fail `only` to discard (CardsMoved) and drawing again. */
function drawOne(state: GameState, ctx: EngineContext, only?: DrawFilter): { state: GameState; cardId?: string; events: EngineEvent[] } {
  let s = state;
  const events: EngineEvent[] = [];
  for (let top = s.zones.draw[0]; top !== undefined; top = s.zones.draw[0]) {
    if (!only || qualifies(card(ctx, top), only, ctx)) return { state: s, cardId: top, events };
    s = transferCards(s, 'draw', 'discard', [top]);
    events.push({ type: 'CardsMoved', from: 'draw', to: 'discard', cardIds: [top] });
  }
  return { state: s, events };
}

function qualifies(c: Card, only: DrawFilter, ctx: EngineContext): boolean {
  return c.exerciseId !== null && ctx.exercisesById.get(c.exerciseId)?.measure === only.measure;
}

function dealFromDraw(state: GameState, zone: ZoneId, count: number, faceUp: boolean, ctx: EngineContext, only?: DrawFilter): Step {
  if (!only) {
    const ids = state.zones.draw.slice(0, count);
    if (ids.length === 0) return { state, events: [] };
    return { state: transferCards(state, 'draw', zone, ids, faceUp), events: [{ type: 'CardsDealt', zone, cardIds: ids, faceUp }] };
  }
  let s = state;
  const events: EngineEvent[] = [];
  const ids: string[] = [];
  while (ids.length < count) {
    const drawn = drawOne(s, ctx, only);
    s = drawn.state;
    events.push(...drawn.events);
    if (drawn.cardId === undefined) break;
    s = transferCards(s, 'draw', zone, [drawn.cardId], faceUp);
    ids.push(drawn.cardId);
  }
  if (ids.length) events.push({ type: 'CardsDealt', zone, cardIds: ids, faceUp });
  return { state: s, events };
}

// ── Conditions ──────────────────────────────────────────────────────────────

export function evaluate(cond: Condition, state: GameState, ctx: EngineContext, x?: Exec): boolean {
  const exec = x ?? { ctx, actor: currentPlayer(state) };
  if (typeof cond === 'string') return getZone(state, zoneId(cond.slice(0, -'.empty'.length) as DslZone, exec, state)).length === 0;
  if ('flag' in cond) return isFlagSet(state, cond.flag);
  if ('anyEmpty' in cond) return playerZoneIds(state, cond.anyEmpty).some((z) => getZone(state, z).length === 0);
  if ('match' in cond) {
    const on = settingValue<MatchOn>(cond.on, ctx.settings);
    return on !== undefined && cardsMatch(selectAll(state, cond.match, exec).map((id) => card(ctx, id)), on);
  }
  if ('compare' in cond) {
    const [a] = select(state, cond.compare[0], exec);
    const [b] = select(state, cond.compare[1], exec);
    if (a === undefined || b === undefined || a === b) return false;
    const va = rankIndex(card(ctx, a));
    const vb = rankIndex(card(ctx, b));
    if (va < 0 || vb < 0) return false; // jokers never win or lose a comparison
    return cond.wins === 'high' ? va > vb : va < vb;
  }
  if ('count' in cond) return compareTo(getZone(state, zoneId(cond.count, exec, state)).length, cond, state, ctx);
  if ('var' in cond) return compareTo(counter(state, cond.var), cond, state, ctx);
  if ('elapsed' in cond) return state.vars[elapsedVar(cond.elapsed)] === true;
  if ('equals' in cond) return ctx.settings[cond.setting] === cond.equals;
  if ('all' in cond) return cond.all.every((c) => evaluate(c, state, ctx, exec));
  if ('any' in cond) return cond.any.some((c) => evaluate(c, state, ctx, exec));
  return !evaluate(cond.not, state, ctx, exec);
}

/** Evaluates the single comparison in a count/var condition; an unset reference is false. */
function compareTo(n: number, cond: Comparison, state: GameState, ctx: EngineContext): boolean {
  const test = (v: NumberRef | undefined, fn: (x: number) => boolean) => {
    const value = v === undefined ? undefined : num(v, ctx.settings, state);
    return value !== undefined && fn(value);
  };
  if ('lt' in cond) return test(cond.lt, (v) => n < v);
  if ('lte' in cond) return test(cond.lte, (v) => n <= v);
  if ('eq' in cond) return test(cond.eq, (v) => n === v);
  if ('gte' in cond) return test(cond.gte, (v) => n >= v);
  return test(cond.gt, (v) => n > v);
}

/** True when there are ≥2 distinct cards and every card shares the property (adjacent-rank: each consecutive pair). */
export function cardsMatch(cards: readonly Card[], on: MatchOn): boolean {
  if (cards.length < 2) return false;
  const pairs = cards.slice(1).map((c, i) => [cards[i], c] as const);
  switch (on) {
    case 'suit':
      return pairs.every(([a, b]) => a.suit === b.suit);
    case 'rank':
      return pairs.every(([a, b]) => a.rank === b.rank);
    case 'color':
      return pairs.every(([a, b]) => colorOf(a.suit) === colorOf(b.suit));
    case 'adjacent-rank':
      return pairs.every(([a, b]) => {
        const ia = rankIndex(a);
        const ib = rankIndex(b);
        if (ia < 0 || ib < 0) return false;
        const d = Math.abs(ia - ib);
        return d === 1 || d === RANK_ORDER.length - 1; // A wraps to both K and 2
      });
  }
}

const colorOf = (suit: Suit) => (suit === 'hearts' || suit === 'diamonds' ? 'red' : suit === 'joker' ? 'joker' : 'black');
const rankIndex = (c: Card) => (RANK_ORDER as readonly string[]).indexOf(c.rank);

// ── Selectors and zones ─────────────────────────────────────────────────────

export function currentPlayer(state: GameState): PlayerId {
  return state.turn.order[state.turn.index];
}

function zoneId(zone: DslZone, x: Exec, state?: GameState): ZoneId {
  if (zone === 'hand' || zone === 'pile') return `${zone}:${x.actor}`;
  if (zone === 'team') {
    if (!state) throw new Error('team zone needs state');
    return `hand:${teamCaptain(state, x.actor)}`;
  }
  return zone;
}

function playerZoneIds(state: GameState, zones: PlayerZones): ZoneId[] {
  if (zones === 'teams') return teamCaptains(state).map((p) => `hand:${p}` as ZoneId);
  return state.turn.order.map((p) => `${zones === 'hands' ? 'hand' : 'pile'}:${p}` as ZoneId);
}

function ownerOf(zone: ZoneId): PlayerId | null {
  return zone.startsWith('hand:') || zone.startsWith('pile:') ? zone.slice(5) : null;
}

function pick(cards: readonly string[], which: string): string[] {
  switch (which) {
    case 'first':
      return cards.slice(0, 1);
    case 'last':
      return cards.slice(-1);
    case 'middle':
      return cards.slice(1, -1);
    default:
      return [...cards];
  }
}

/** Cards chosen by selectors with the zone each came from; union in order, first occurrence wins. */
function selectWithZones(state: GameState, selectors: readonly Selector[], x: Exec): { id: string; zone: ZoneId }[] {
  const out: { id: string; zone: ZoneId }[] = [];
  const seen = new Set<string>();
  const add = (id: string, zone: ZoneId) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, zone });
  };
  for (const selector of selectors) {
    if (selector === 'intent.card') {
      const id = x.intent?.type === 'play' ? x.intent.cardId : undefined;
      const zone = id === undefined ? undefined : findZone(state, id);
      if (id !== undefined && zone) add(id, zone);
      continue;
    }
    const [zoneName, which] = selector.split('.') as [DslZone | PlayerZones, string];
    const zones = zoneName === 'hands' || zoneName === 'piles' || zoneName === 'teams' ? playerZoneIds(state, zoneName) : [zoneId(zoneName, x, state)];
    for (const zone of zones) for (const id of pick(getZone(state, zone), which)) add(id, zone);
  }
  return out;
}

/** Card ids chosen by one selector, in zone order (public for tests and tools). */
export function select(state: GameState, selector: Selector, x?: Exec): string[] {
  return selectWithZones(state, [selector], x ?? ({ actor: currentPlayer(state) } as Exec)).map((c) => c.id);
}

function selectAll(state: GameState, selectors: readonly Selector[], x: Exec): string[] {
  return selectWithZones(state, selectors, x).map((c) => c.id);
}

function groupBySourceZone(picked: readonly { id: string; zone: ZoneId }[]): Map<ZoneId, string[]> {
  const groups = new Map<ZoneId, string[]>();
  for (const { id, zone } of picked) groups.set(zone, [...(groups.get(zone) ?? []), id]);
  return groups;
}

function findZone(state: GameState, cardId: string): ZoneId | undefined {
  for (const z of ['draw', 'discard', 'table'] as const) if (state.zones[z].includes(cardId)) return z;
  for (const p of state.turn.order) {
    if (state.zones.hands[p]?.includes(cardId)) return `hand:${p}`;
    if (state.zones.piles[p]?.includes(cardId)) return `pile:${p}`;
  }
  return undefined;
}

// ── Teams ───────────────────────────────────────────────────────────────────

/** Teams are interleaved by seat: with T teams, seat s is on team s % T. The captain (lowest seat) holds the shared hand. */
export function teamOf(state: GameState, playerId: PlayerId): number {
  const size = teamSize(state);
  const seat = state.players.find((p) => p.id === playerId)?.seat ?? 0;
  return size ? seat % teamCount(state) : seat;
}

export function teamMembers(state: GameState, team: number): PlayerId[] {
  return state.players.filter((p) => teamOf(state, p.id) === team).sort((a, b) => a.seat - b.seat).map((p) => p.id);
}

export function teamCaptain(state: GameState, playerId: PlayerId): PlayerId {
  return teamMembers(state, teamOf(state, playerId))[0] ?? playerId;
}

function teamCaptains(state: GameState): PlayerId[] {
  return Array.from({ length: teamCount(state) }, (_, t) => teamMembers(state, t)[0]).filter((p): p is PlayerId => !!p);
}

function teamSize(state: GameState): number {
  const v = state.vars[TEAM_SIZE];
  return typeof v === 'number' ? v : 0;
}

function teamCount(state: GameState): number {
  const size = teamSize(state);
  return size ? Math.ceil(state.players.length / size) : state.players.length;
}

/** Every member of each team whose shared hand is empty wins. */
function emptyTeamWinners(state: GameState): Step {
  const winners = teamCaptains(state)
    .filter((captain) => getZone(state, `hand:${captain}`).length === 0)
    .flatMap((captain) => teamMembers(state, teamOf(state, captain)));
  return recordWinners(state, winners);
}

// ── Betting (fit-poker) ─────────────────────────────────────────────────────

function num0(state: GameState, key: string): number {
  const v = state.vars[key];
  return typeof v === 'number' ? v : 0;
}

function clearBetting(state: GameState): GameState {
  return Object.keys(state.vars).filter((k) => k.startsWith('bet:')).reduce((s, k) => unsetVar(s, k), state);
}

/** Players still in the hand (not folded), seat order. */
export function activeBettors(state: GameState): PlayerId[] {
  return state.turn.order.filter((p) => !state.vars[foldedVar(p)]);
}

/** Current betting table for views: pot, bet to call, each player's stake and fold state. */
export function bettingOf(state: GameState): { active: boolean; pot: number; current: number; stakes: Record<PlayerId, number>; folded: PlayerId[] } {
  return {
    active: state.vars[BET_ACTIVE] === true,
    pot: num0(state, BET_POT),
    current: num0(state, BET_CURRENT),
    stakes: Object.fromEntries(state.turn.order.map((p) => [p, num0(state, betInVar(p))])),
    folded: state.turn.order.filter((p) => state.vars[foldedVar(p)]),
  };
}

/**
 * One betting action by the current player: bet (raise the stake to `amount`, ≤ maxBet), call (match
 * the stake), or pass (check if nothing to call, else fold). The turn moves to the next player still in.
 * The round closes when one player remains, or everyone still in has acted since the last raise and
 * matched the stake; then `betting.then` runs (showdown).
 */
function betting(def: GameDefinition, state: GameState, intent: Intent, x: Exec): Step {
  const { ctx } = x;
  const me = intent.playerId;
  if (currentPlayer(state) !== me) return reject(state, intent, 'not-your-turn');
  const stake = num0(state, betInVar(me));
  const current = num0(state, BET_CURRENT);
  let s = state;
  let event: EngineEvent;

  if (intent.type === 'bet') {
    const maxBet = num(def.betting!.maxBet, ctx.settings, state) ?? 0;
    if (intent.amount <= current || intent.amount > maxBet) return reject(state, intent, 'bad-bet');
    const pot = num0(s, BET_POT) + (intent.amount - stake);
    s = setVar(setVar(setVar(s, betInVar(me), intent.amount), BET_CURRENT, intent.amount), BET_POT, pot);
    s = state.turn.order.reduce((acc, p) => unsetVar(acc, betActedVar(p)), s); // a raise reopens action
    event = { type: 'BetPlaced', playerId: me, amount: intent.amount, pot };
  } else if (intent.type === 'call') {
    if (stake >= current) return reject(state, intent, 'nothing-to-call');
    const pot = num0(s, BET_POT) + (current - stake);
    s = setVar(setVar(s, betInVar(me), current), BET_POT, pot);
    event = { type: 'BetPlaced', playerId: me, amount: current, pot };
  } else if (stake < current) {
    s = setVar(s, foldedVar(me), true);
    event = { type: 'PlayerFolded', playerId: me };
  } else {
    event = { type: 'PlayerChecked', playerId: me };
  }
  s = setVar(s, betActedVar(me), true);

  const active = activeBettors(s);
  const target = num0(s, BET_CURRENT);
  const closed = active.length <= 1 || active.every((p) => s.vars[betActedVar(p)] && num0(s, betInVar(p)) === target);
  if (!closed) {
    // Advance to the next player still in the hand.
    const order = s.turn.order;
    let index = s.turn.index;
    for (let i = 0; i < order.length; i++) {
      index = (index + 1) % order.length;
      if (!s.vars[foldedVar(order[index])]) break;
    }
    return { state: { ...s, turn: { ...s.turn, index } }, events: [event] };
  }
  s = unsetVar(s, BET_ACTIVE);
  const after = runSteps({ state: s, events: [event] }, def.betting!.then, ctx, { ctx, actor: currentPlayer(s), def });
  return checkEnd({ state: clearBetting(after.state), events: after.events }, def, ctx);
}

/** Best poker hand among players still in (their cards in the selection) wins; exact ties share. */
function pokerWinners(state: GameState, selector: Selector, x: Exec): Step {
  const byPlayer = new Map<PlayerId, Card[]>();
  for (const { id, zone } of selectWithZones(state, [selector], x)) {
    const owner = ownerOf(zone);
    if (!owner || state.vars[foldedVar(owner)]) continue;
    byPlayer.set(owner, [...(byPlayer.get(owner) ?? []), card(x.ctx, id)]);
  }
  const hands = [...byPlayer].map(([p, cards]) => ({ p, hand: evaluatePoker(cards) }));
  if (!hands.length) return recordWinners(state, []);
  const best = hands.reduce((a, b) => (comparePoker(b.hand, a.hand) > 0 ? b : a)).hand;
  return recordWinners(state, hands.filter((h) => comparePoker(h.hand, best) === 0).map((h) => h.p));
}

/** Each loser (folded included) performs the pot with the exercise of their highest card. */
function assignPotToLosers(state: GameState, x: Exec): Step {
  const pot = num0(state, BET_POT);
  const winners = winnersOf(state);
  const rankValue = (id: string) => rankIndex(card(x.ctx, id));
  return state.turn.order
    .filter((p) => !winners.includes(p))
    .reduce((acc, p) => chain(acc, (s) => {
      const best = [...getZone(s, `hand:${p}`)].filter((id) => card(x.ctx, id).exerciseId).sort((a, b) => rankValue(b) - rankValue(a))[0];
      return best ? assignAmount(s, p, best, pot, x.ctx) : { state: s, events: [] };
    }), { state, events: [] } as Step);
}

function recordWinners(state: GameState, winners: PlayerId[]): Step {
  const ordered = state.turn.order.filter((p) => winners.includes(p));
  const round = roundNumber(state);
  let s = setVar(state, WINNERS, ordered.join(','));
  for (const p of ordered) s = addWin(s, p);
  return { state: s, events: ordered.map((playerId) => ({ type: 'RoundWon' as const, playerId, round })) };
}

// ── Bluff (bluff-pile) ──────────────────────────────────────────────────────

/** Open claim, if any: who claimed, which rank, how many cards (cards themselves stay secret). */
export function openClaim(state: GameState): { by: PlayerId; rank: string; count: number } | null {
  const by = state.vars[CLAIM_BY];
  return typeof by === 'string' ? { by, rank: String(state.vars[CLAIM_RANK]), count: num0(state, CLAIM_COUNT) } : null;
}

/** The rank the current player must claim next. */
export function requiredRank(state: GameState): string {
  return CLAIM_RANKS[num0(state, BLUFF_NEXT_RANK) % CLAIM_RANKS.length];
}

function closeClaim(state: GameState): { state: GameState; events: EngineEvent[] } {
  const claim = openClaim(state);
  let s = [CLAIM_BY, CLAIM_RANK, CLAIM_COUNT, CLAIM_CARDS].reduce((acc, k) => unsetVar(acc, k), state);
  const events: EngineEvent[] = [];
  if (claim && getZone(s, `hand:${claim.by}`).length === 0 && !s.vars[BLUFF_WINNER]) {
    s = setVar(s, BLUFF_WINNER, claim.by);
    const won = recordWinners(s, [claim.by]);
    s = won.state;
    events.push(...won.events);
  }
  return { state: s, events };
}

/**
 * The current player places 1..maxCards of their cards face down as the required rank. Placing a
 * claim accepts the previous one (a claimant with an empty hand then wins). Turn passes on.
 */
function claim(def: GameDefinition, state: GameState, intent: Extract<Intent, { type: 'claim' }>, x: Exec): Step {
  const me = intent.playerId;
  if (state.phase === 'setup') return reject(state, intent, 'not-dealt');
  if (pendingTasks(state).length) return reject(state, intent, 'tasks-pending');
  if (currentPlayer(state) !== me) return reject(state, intent, 'not-your-turn');
  const ids = [...new Set(intent.cardIds)];
  if (ids.length !== intent.cardIds.length || ids.length > def.bluff!.maxCards) return reject(state, intent, 'bad-claim');
  const hand = getZone(state, `hand:${me}`);
  if (!ids.every((id) => hand.includes(id))) return reject(state, intent, 'not-in-hand');

  const accepted = closeClaim(state);
  if (accepted.state.vars[BLUFF_WINNER]) return checkEnd(accepted, def, x.ctx);

  const rank = requiredRank(accepted.state);
  let s = transferCards(accepted.state, `hand:${me}`, 'table', ids, false);
  s = setVar(setVar(setVar(setVar(s, CLAIM_BY, me), CLAIM_RANK, rank), CLAIM_COUNT, ids.length), CLAIM_CARDS, ids.join(','));
  s = setVar(s, BLUFF_NEXT_RANK, num0(s, BLUFF_NEXT_RANK) + 1);
  const next = (s.turn.index + 1) % s.turn.order.length;
  s = { ...s, turn: { ...s.turn, index: next } };
  return {
    state: s,
    events: [
      ...accepted.events,
      { type: 'CardsMoved', from: `hand:${me}`, to: 'table', cardIds: ids },
      { type: 'ClaimMade', playerId: me, rank, count: ids.length },
    ],
  };
}

/**
 * Any other player calls the open claim. The claimed cards are revealed; if any isn't the claimed
 * rank (jokers are wild), the claimant lied. The loser — the liar, or a wrong challenger — performs
 * every card in the pile and takes the pile into their hand. A truthful claimant with an empty hand wins.
 */
function challenge(def: GameDefinition, state: GameState, intent: Intent, x: Exec): Step {
  const me = intent.playerId;
  const open = openClaim(state);
  if (!open) return reject(state, intent, 'no-claim');
  if (open.by === me) return reject(state, intent, 'own-claim');
  if (pendingTasks(state).length) return reject(state, intent, 'tasks-pending');

  const claimed = String(state.vars[CLAIM_CARDS] ?? '').split(',').filter(Boolean);
  const lied = claimed.some((id) => {
    const c = card(x.ctx, id);
    return c.suit !== 'joker' && c.rank !== open.rank;
  });
  const loser = lied ? open.by : me;
  const pile = [...state.zones.table];
  let step: Step = {
    state: { ...state, faceUp: [...state.faceUp, ...claimed.filter((id) => !state.faceUp.includes(id))] },
    events: [
      { type: 'CardsRevealed', cardIds: claimed },
      { type: 'ClaimChallenged', playerId: me, claimant: open.by, lied, loser },
    ],
  };
  step = chain(step, (s) => assignTasks(s, loser, pile, x.ctx));
  step = chain(step, (s) => ({
    state: transferCards(s, 'table', `hand:${loser}`, pile, false),
    events: [{ type: 'CardsMoved', from: 'table', to: `hand:${loser}`, cardIds: pile }],
  }));
  step = chain(step, (s) => closeClaim(s));
  return checkEnd(step, def, x.ctx);
}

function isFlagSet(state: GameState, flag: string): boolean {
  if (flag === 'betting') return state.vars[BET_ACTIVE] === true;
  if (flag === 'claim-open') return typeof state.vars[CLAIM_BY] === 'string';
  const v = state.vars[flag];
  return v !== undefined && v !== false && v !== 0 && v !== '';
}

// ── Vars and utils ──────────────────────────────────────────────────────────

const ENDING = 'ending';
const TEAM_SIZE = 'teams:size';
const BET_ACTIVE = 'bet:active';
const BET_POT = 'bet:pot';
const BET_CURRENT = 'bet:current';
const betInVar = (p: PlayerId) => `bet:in:${p}`;
const foldedVar = (p: PlayerId) => `bet:folded:${p}`;
const betActedVar = (p: PlayerId) => `bet:acted:${p}`;
const CLAIM_BY = 'claim:by';
const CLAIM_RANK = 'claim:rank';
const CLAIM_COUNT = 'claim:count';
/** `secret:` vars are removed from every player's view (§7 redaction). */
export const SECRET_PREFIX = 'secret:';
const CLAIM_CARDS = `${SECRET_PREFIX}claim:cards`;
const BLUFF_NEXT_RANK = 'bluff:next';
const BLUFF_WINNER = 'bluff:winner';
/** Bluff claims cycle A, 2 … K. */
const CLAIM_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
const WINNERS = 'winners';
const RACE_WINNER = 'race:winner';
const RACE_FIRST_TASK = 'race:firstTask';
const elapsedVar = (timerId: string) => `elapsed:${timerId}`;
const counterVar = (name: string) => `var:${name}`;
const actedVar = (playerId: PlayerId) => `acted:${playerId}`;
const winsVar = (playerId: PlayerId) => `wins:${playerId}`;

function setVar(state: GameState, key: string, value: string | number | boolean): GameState {
  return { ...state, vars: { ...state.vars, [key]: value } };
}

function unsetVar(state: GameState, key: string): GameState {
  if (!(key in state.vars)) return state;
  const vars = { ...state.vars };
  delete vars[key];
  return { ...state, vars };
}

function addWin(state: GameState, playerId: PlayerId): GameState {
  const current = state.vars[winsVar(playerId)];
  return setVar(state, winsVar(playerId), (typeof current === 'number' ? current : 0) + 1);
}

/** Winner ids from the last `winners` step (empty when nobody won). */
export function winnersOf(state: GameState): PlayerId[] {
  const v = state.vars[WINNERS];
  return typeof v === 'string' && v ? v.split(',') : [];
}

/** Rounds won so far per player. */
export function winsOf(state: GameState, playerId: PlayerId): number {
  const v = state.vars[winsVar(playerId)];
  return typeof v === 'number' ? v : 0;
}

/** Whether a player has acted in the current simultaneous round. */
export function hasActed(state: GameState, playerId: PlayerId): boolean {
  return state.vars[actedVar(playerId)] === true;
}

/** Whether the game is in its end phase (end.then ran; waiting for leftover tasks). */
export function isEnding(state: GameState): boolean {
  return state.vars[ENDING] === true;
}

function roundNumber(state: GameState): number {
  const r = counter(state, 'round');
  return r > 0 ? r : state.turn.round;
}

function taskNumber(t: Task): number {
  return Number(t.id.slice(1));
}

/** Current value of a DSL counter (0 if never incremented). `$players` is the number of players. */
export function counter(state: GameState, name: string): number {
  if (name === '$players') return state.players.length;
  const v = state.vars[counterVar(name)];
  return typeof v === 'number' ? v : 0;
}

const toArray = <T>(v: T | T[]): T[] => (Array.isArray(v) ? v : [v]);

function num(value: NumberRef, settings: GameSettings, state: GameState): number | undefined {
  if (typeof value === 'object' && 'var' in value) return counter(state, value.var);
  const v = settingValue<number | null>(value, settings);
  return typeof v === 'number' ? v : undefined;
}

function card(ctx: EngineContext, id: string): Card {
  const c = ctx.cardsById.get(id);
  if (!c) throw new Error(`unknown card ${id}`);
  return c;
}

function assertNever(v: never): never {
  throw new Error(`Unhandled DSL step: ${JSON.stringify(v)}`);
}
