import { loadContent } from '../../../testing/db';
import { resolveSettings } from '../../domain/engine/dsl/settings';
import { simulate } from '../../domain/engine/dsl/simulate';
import type { Session } from '../../domain/models/schemas';
import { historyStats } from './history-stats';

const content = loadContent();
const exercisesById = new Map(content.exercises.exercises.map((e) => [e.id, e]));

function playedSession(id: string, deckId: string, gameId: string, startedAt: number, seed: number, ended = true): Session {
  const def = content.games.games.find((g) => g.id === gameId)!;
  const deck = content.decks.decks.find((d) => d.id === deckId)!;
  const settings = resolveSettings(def);
  const result = simulate({ def, deck, exercises: content.exercises.exercises, settings, seed, players: ['me'] });
  return {
    id, seed, startedAt,
    ...(ended ? { endedAt: startedAt + 25 * 60000, outcome: 'finished' as const } : {}),
    game: { id: def.id, name: def.name },
    deck: { id: deck.id, name: deck.name, suits: deck.suits, cards: deck.cards },
    settings, players: [{ id: 'me', name: 'Me' }],
    log: result.events, totals: result.state.totals,
  };
}

describe('historyStats', () => {
  const bodyweight = playedSession('a', 'deck-bodyweight', 'solo-deal', 1_000, 1);
  const yoga = playedSession('b', 'deck-yoga', 'end-match', 5_000, 2, false);
  const stats = historyStats([bodyweight, yoga], exercisesById);

  it('lists sessions newest first with per-session work', () => {
    expect(stats.sessions.map((r) => [r.session.id, r.inProgress, r.minutes])).toEqual([['b', true, null], ['a', false, 25]]);
    expect(stats.workouts).toBe(2);
    expect(stats.minutes).toBe(25);
  });

  it('per-exercise totals equal the sum of session totals, with the right unit', () => {
    const sum = (s: Session) => Object.values(s.totals['me']).reduce((a, b) => a + b, 0);
    expect(stats.byExercise.reduce((n, t) => n + t.amount, 0)).toBe(sum(bodyweight) + sum(yoga));
    const plank = stats.byExercise.find((t) => t.key === 'bw-plank')!;
    expect(plank).toMatchObject({ name: 'Forearm Plank', measure: 'seconds', sessions: 1, amount: bodyweight.totals['me']['bw-plank'] });
  });

  it('per-group reps/seconds add up to the same work, labeled from each deck', () => {
    const groupReps = stats.byGroup.reduce((n, g) => n + g.reps, 0);
    const groupSecs = stats.byGroup.reduce((n, g) => n + g.seconds, 0);
    expect(groupReps).toBe(stats.reps);
    expect(groupSecs).toBe(stats.seconds);
    expect(stats.byExercise.filter((t) => t.measure === 'reps').reduce((n, t) => n + t.amount, 0)).toBe(stats.reps);
    const labels = stats.byGroup.map((g) => g.label);
    expect(labels).toEqual(expect.arrayContaining(['Legs', 'Push', 'Pull', 'Core', 'Hips & legs', 'Spine']));
    expect(stats.byGroup.find((g) => g.label === 'Legs')).toMatchObject({ suit: 'hearts' });
    expect(labels).not.toContain('Wild'); // default jokerRule is rest, which never counts
  });

  it('handles no sessions', () => {
    expect(historyStats([], exercisesById)).toEqual({ sessions: [], workouts: 0, reps: 0, seconds: 0, minutes: 0, byExercise: [], byGroup: [] });
  });
});
