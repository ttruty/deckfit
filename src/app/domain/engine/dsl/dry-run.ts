import type { GameDefinition } from '../../models/game.schema';
import type { Deck, Exercise, GameSettings } from '../../models/schemas';
import type { EngineEvent } from '../events';
import type { GameState } from '../state';
import { resolveSettings } from './settings';
import { simulate } from './simulate';

/** Rough pace used to turn reps into time for the dry-run estimate. */
export const SECONDS_PER_REP = 3;

export interface WorkEstimate {
  reps: number;
  /** Timed exercises and bonus cardio. */
  seconds: number;
  /** Joker rest. */
  restSeconds: number;
  /** seconds + restSeconds + reps × SECONDS_PER_REP. */
  totalSeconds: number;
}

export interface DryRunResult {
  events: EngineEvent[];
  turns: number;
  /** Whether the game reached GameOver within the turn limit. */
  finished: boolean;
  /** Set when the scripted players got stuck: the engine rejected a move the script had to make. */
  error: string | null;
  players: string[];
  perPlayer: Record<string, WorkEstimate>;
  total: WorkEstimate;
  state: GameState | null;
}

/**
 * The builder's dry run (§6.4): plays `turns` turns of a game with the deterministic scripted players
 * of `simulate()` on a seeded deck, through the same engine a real session uses, and estimates the
 * work from the tasks completed. Never throws: an invalid definition or stuck script is reported.
 */
export function dryRun(opts: {
  def: GameDefinition;
  deck: Pick<Deck, 'cards'>;
  exercises: readonly Pick<Exercise, 'id' | 'measure'>[];
  seed: number;
  players?: number;
  turns?: number;
  settings?: Partial<GameSettings>;
}): DryRunResult {
  const count = Math.min(Math.max(opts.players ?? opts.def.players.min, opts.def.players.min), opts.def.players.max);
  const players = Array.from({ length: count }, (_, i) => `p${i + 1}`);
  const empty = (): WorkEstimate => ({ reps: 0, seconds: 0, restSeconds: 0, totalSeconds: 0 });
  const base = { players, perPlayer: Object.fromEntries(players.map((p) => [p, empty()])), total: empty() };
  let result: ReturnType<typeof simulate>;
  try {
    const settings = resolveSettings(opts.def, opts.settings);
    result = simulate({
      def: opts.def, deck: opts.deck, exercises: opts.exercises, settings, seed: opts.seed, players,
      maxTurns: opts.turns ?? 20, maxIntents: 2000,
    });
  } catch (err) {
    return { ...base, events: [], turns: 0, finished: false, error: err instanceof Error ? err.message : String(err), state: null };
  }

  const { state, events, turns } = result;
  for (const t of state.tasks) {
    if (t.status !== 'done') continue;
    const amount = events.find((e) => e.type === 'TaskCompleted' && e.taskId === t.id);
    const done = amount?.type === 'TaskCompleted' ? amount.amount : t.amount;
    for (const est of [base.perPlayer[t.playerId], base.total]) {
      if (!est) continue;
      if (t.kind === 'rest') est.restSeconds += done;
      else if (t.measure === 'seconds') est.seconds += done;
      else est.reps += done;
    }
  }
  for (const est of [...Object.values(base.perPlayer), base.total]) {
    est.totalSeconds = est.seconds + est.restSeconds + est.reps * SECONDS_PER_REP;
  }
  return { ...base, events, turns, finished: state.phase === 'finished', error: null, state };
}
