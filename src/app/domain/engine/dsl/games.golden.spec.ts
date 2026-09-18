import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GamesFileSchema, type GameDefinition } from '../../models/game.schema';
import { DecksFileSchema, ExercisesFileSchema, type GameSettings } from '../../models/schemas';
import { EngineEventSchema } from '../events';
import { resolveSettings } from './settings';
import { simulate } from './simulate';

/**
 * Golden event logs: built-in games on the built-in bodyweight deck with a fixed seed.
 * A diff here means game behavior changed. If intended, review the new log and
 * delete that golden file and re-run `npm test` to record it (ng test has no -u); review the
 * diff and say why in the commit.
 */
const SEED = 2026;
const content = (f: string): unknown => JSON.parse(readFileSync(join(process.cwd(), 'src/assets/content', f), 'utf8'));
const { games } = GamesFileSchema.parse(content('games.json'));
const deck = DecksFileSchema.parse(content('decks.json')).decks.find((d) => d.id === 'deck-bodyweight')!;
const { exercises } = ExercisesFileSchema.parse(content('exercises.json'));
const gameById = (id: string): GameDefinition => {
  const g = games.find((x) => x.id === id);
  if (!g) throw new Error(`missing game ${id}`);
  return g;
};

function play(id: string, overrides: Partial<GameSettings> = {}, seed = SEED, players?: string[]) {
  const def = gameById(id);
  return simulate({ def, deck, exercises, settings: resolveSettings(def, overrides), seed, ...(players ? { players } : {}) });
}

/** Invariants every finished game must satisfy, independent of the snapshot. */
function expectWellFormed(result: ReturnType<typeof simulate>, cardsInPlay: number, opts: { cardsReassigned?: boolean } = {}) {
  const { state, events } = result;
  events.forEach((e) => expect(EngineEventSchema.parse(e)).toEqual(e));
  expect(state.phase).toBe('finished');
  expect(events.at(-1)?.type).toBe('GameOver');
  expect(events.filter((e) => e.type === 'GameOver')).toHaveLength(1);
  expect(state.tasks.every((t) => t.status === 'done')).toBe(true);
  // Every card in play is assigned at most once per player (bluff piles return to hands and can be worked again).
  for (const { id } of opts.cardsReassigned ? [] : state.players) {
    const assigned = state.tasks.filter((t) => t.playerId === id).flatMap((t) => t.cardIds);
    expect(new Set(assigned).size).toBe(assigned.length);
  }
  // No card is lost or duplicated across zones.
  const z = state.zones;
  const everywhere = [...z.draw, ...z.discard, ...z.table, ...Object.values(z.hands).flat(), ...Object.values(z.piles).flat()];
  expect(everywhere).toHaveLength(cardsInPlay);
  expect(new Set(everywhere).size).toBe(cardsInPlay);
  // Totals equal the sum of completed work (rest excluded), per player.
  for (const { id } of state.players) {
    const work = state.tasks.filter((t) => t.playerId === id && t.kind !== 'rest').reduce((n, t) => n + t.amount, 0);
    expect(Object.values(state.totals[id]).reduce((a, b) => a + b, 0)).toBe(work);
  }
}

const logFile = (name: string) => `./__golden__/${name}.seed-${SEED}.json`;
const pretty = (events: unknown[]) => JSON.stringify(events, null, 1) + '\n';

describe('solo-deal golden log', () => {
  it('matches the recorded event log', async () => {
    const result = play('solo-deal');
    expectWellFormed(result, 54);
    expect(result.turns).toBe(54); // one flip per card
    await expect(pretty(result.events)).toMatchFileSnapshot(logFile('solo-deal'));
  });

  it('assigns every non-joker card exactly once, and one 30s rest per joker (default jokerRule)', () => {
    const { state } = play('solo-deal');
    expect(state.tasks.filter((t) => t.kind === 'exercise')).toHaveLength(52);
    expect(state.tasks.filter((t) => t.kind === 'rest').map((t) => t.amount)).toEqual([30, 30]);
  });

  it('with a suit filter only those suits are dealt', async () => {
    const result = play('solo-deal', { suits: ['hearts'] });
    expectWellFormed(result, 13);
    expect(result.turns).toBe(13);
    expect(result.state.tasks.every((t) => t.cardIds.every((id) => id.includes('-hearts-')))).toBe(true);
    await expect(pretty(result.events)).toMatchFileSnapshot(logFile('solo-deal.hearts'));
  });

  it('is deterministic and seed-dependent', () => {
    expect(play('solo-deal').events).toEqual(play('solo-deal').events);
    expect(play('solo-deal', {}, SEED + 1).events).not.toEqual(play('solo-deal').events);
  });
});

describe('end-match golden log', () => {
  it.each(['suit', 'rank', 'color'])('matchOn=%s matches the recorded event log', async (matchOn) => {
    const result = play('end-match', { matchOn });
    expectWellFormed(result, 54);
    await expect(pretty(result.events)).toMatchFileSnapshot(logFile(`end-match.${matchOn}`));
  });

  it('follows the rules on every turn (checked independently of the interpreter)', () => {
    const { events } = play('end-match', { matchOn: 'suit' });
    const suitOf = new Map(deck.cards.map((c) => [c.id, c.suit]));
    // Rebuild the row from events and verify each turn's decision.
    let row: string[] = [];
    let i = 0;
    const next = () => events[i++];
    while (i < events.length) {
      const e = next();
      if (e.type === 'CardsDealt' && e.zone === 'table') row = [...row, ...e.cardIds];
      if (e.type !== 'CardsMoved' && e.type !== 'TaskAssigned') continue;
      // A turn starts with its TaskAssigned events; gather them.
      if (e.type === 'TaskAssigned') {
        const turnCards = [...e.task.cardIds];
        while (events[i]?.type === 'TaskAssigned') turnCards.push(...(next() as { task: { cardIds: string[] } }).task.cardIds);
        const [first, last] = [row[0], row[row.length - 1]];
        if (row.length < 4) expect(new Set(turnCards)).toEqual(new Set(row));
        else if (suitOf.get(first) === suitOf.get(last)) expect(new Set(turnCards)).toEqual(new Set([first, last]));
        else expect(new Set(turnCards)).toEqual(new Set(row.slice(1, -1)));
      }
      const move = e.type === 'CardsMoved' ? e : (events[i]?.type === 'CardsMoved' ? next() : undefined);
      if (move && move.type === 'CardsMoved') row = row.filter((id) => !move.cardIds.includes(id));
    }
    expect(row).toEqual([]);
  });
});

describe('pyramid-climb golden log', () => {
  it('matches the recorded event log', async () => {
    const result = play('pyramid-climb');
    expectWellFormed(result, 54);
    await expect(pretty(result.events)).toMatchFileSnapshot(logFile('pyramid-climb'));
  });

  it('deals rows of 1, 2, 3 … up to the rows setting, one flip per row', () => {
    const rowSizes = (rows: number) =>
      play('pyramid-climb', { rows }).events.flatMap((e) => (e.type === 'CardsDealt' ? [e.cardIds.length] : []));
    expect(rowSizes(5)).toEqual([1, 2, 3, 4, 5]);
    expect(rowSizes(3)).toEqual([1, 2, 3]);
    const { state, turns } = play('pyramid-climb', { rows: 9 });
    expect(turns).toBe(9);
    expect(state.zones.discard.length + state.zones.table.length).toBe(45);
  });

  it('stops when the draw pile runs out before the last row', () => {
    // 9 rows need 45 cards; a 20-card deck ends partway through row 6 (1+2+3+4+5 = 15, then 5 of 6).
    const def = gameById('pyramid-climb');
    const small = { cards: deck.cards.slice(0, 20) };
    const result = simulate({ def, deck: small, exercises, settings: resolveSettings(def, { rows: 9 }), seed: SEED });
    expect(result.events.flatMap((e) => (e.type === 'CardsDealt' ? [e.cardIds.length] : []))).toEqual([1, 2, 3, 4, 5, 5]);
    expect(result.state.phase).toBe('finished');
  });
});

describe('interval-deck golden log', () => {
  it('matches the recorded event log (solo)', async () => {
    const result = play('interval-deck');
    expectWellFormed(result, 54);
    await expect(pretty(result.events)).toMatchFileSnapshot(logFile('interval-deck'));
  });

  it('matches the recorded event log with 3 players on one device', async () => {
    const result = play('interval-deck', { players: { min: 1, max: 6 } }, SEED, ['p1', 'p2', 'p3']);
    expectWellFormed(result, 54);
    await expect(pretty(result.events)).toMatchFileSnapshot(logFile('interval-deck.3p'));
  });

  it('runs 8 rounds of work then rest; every player gets each card; timed tasks last the work window', () => {
    const { events, state, turns } = play('interval-deck', {}, SEED, ['p1', 'p2']);
    expect(turns).toBe(8);
    const phases = events.flatMap((e) => (e.type === 'TimerElapsed' ? [e.phase] : []));
    expect(phases).toEqual(Array(7).fill(['work', 'rest']).flat()); // round 8 ends the game as soon as work is logged
    const flipped = events.flatMap((e) => (e.type === 'CardFlipped' ? [e.cardId] : []));
    for (const cardId of flipped) {
      const owners = state.tasks.filter((t) => t.cardIds.includes(cardId)).map((t) => t.playerId);
      expect(owners.length === 0 || owners.join() === 'p1,p2').toBe(true); // skipped jokers get no task
    }
    expect(state.tasks.filter((t) => t.measure === 'seconds').every((t) => t.amount === 20)).toBe(true);
  });

  it('honors rounds, work, and rest settings', () => {
    const { events, turns } = play('interval-deck', { rounds: 3, workSec: 45, restSec: 15 });
    expect(turns).toBe(3);
    const started = events.flatMap((e) => (e.type === 'TimerStarted' ? [[e.timer.phase, e.timer.durationSec, e.timer.restSec]] : []));
    expect(started[0]).toEqual(['work', 45, 15]);
    expect(started[1]).toEqual(['rest', 15, 15]); // durationSec is the current phase's length
  });
});

// ── Group games (3 players) ─────────────────────────────────────────────────

const PLAYERS = ['p1', 'p2', 'p3'];
const byId = new Map(deck.cards.map((c) => [c.id, c]));
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const rankOf = (id: string) => RANKS.indexOf(byId.get(id)!.rank);
const measureOf = new Map(exercises.map((e) => [e.id, e.measure]));

describe('high-card-duel golden log', () => {
  const result = play('high-card-duel', {}, SEED, PLAYERS);

  it('matches the recorded event log', async () => {
    expectWellFormed(result, 54);
    await expect(pretty(result.events)).toMatchFileSnapshot(logFile('high-card-duel.3p'));
  });

  it('each round: highest card(s) win, every other player works all flipped cards (checked from the log)', () => {
    const { events, state } = result;
    let flipped = new Map<string, string>(); // player → card this round
    let roundsSeen = 0;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.type === 'CardsDealt' && e.zone.startsWith('pile:')) flipped.set(e.zone.slice(5), e.cardIds[0]);
      if (e.type !== 'RoundWon' && !(e.type === 'TaskAssigned' && flipped.size === 3)) continue;
      // Gather this round's outcome: RoundWon* then TaskAssigned*.
      const winners: string[] = [];
      const assigned = new Map<string, Set<string>>();
      let j = i;
      for (; j < events.length && (events[j].type === 'RoundWon' || events[j].type === 'TaskAssigned'); j++) {
        const ev = events[j];
        if (ev.type === 'RoundWon') winners.push(ev.playerId);
        if (ev.type === 'TaskAssigned') {
          const set = assigned.get(ev.task.playerId) ?? new Set();
          ev.task.cardIds.forEach((c) => set.add(c));
          assigned.set(ev.task.playerId, set);
        }
      }
      const ranks = [...flipped].map(([p, c]) => [p, rankOf(c)] as const).filter(([, r]) => r >= 0);
      const best = Math.max(...ranks.map(([, r]) => r));
      const top = ranks.filter(([, r]) => r === best).map(([p]) => p);
      const expectedWinners = top.length === flipped.size ? [] : top;
      expect(winners).toEqual(PLAYERS.filter((p) => expectedWinners.includes(p)));
      const workable = [...flipped.values()].filter((c) => byId.get(c)!.exerciseId);
      for (const p of PLAYERS) {
        const cards = [...(assigned.get(p) ?? [])].sort();
        expect(cards).toEqual(expectedWinners.includes(p) ? [] : [...workable].sort());
      }
      roundsSeen++;
      flipped = new Map();
      i = j - 1;
    }
    expect(roundsSeen).toBe(6);
    expect(Object.values(state.scores).reduce((a, b) => a + b, 0)).toBe(events.filter((e) => e.type === 'RoundWon').length);
  });
});

describe('rep-race golden log', () => {
  const result = play('rep-race', {}, SEED, PLAYERS);

  it('matches the recorded event log', async () => {
    expectWellFormed(result, 54);
    await expect(pretty(result.events)).toMatchFileSnapshot(logFile('rep-race.3p'));
  });

  it('every round: everyone gets the same rep-only cards, timed cards are redrawn, one winner', () => {
    const { events, state } = result;
    const tableDeals = events.flatMap((e) => (e.type === 'CardsDealt' && e.zone === 'table' ? [e.cardIds] : []));
    expect(tableDeals).toHaveLength(5);
    for (const ids of tableDeals) {
      expect(ids).toHaveLength(3);
      expect(ids.every((id) => measureOf.get(byId.get(id)!.exerciseId ?? '') === 'reps')).toBe(true);
    }
    const redrawn = events.flatMap((e) => (e.type === 'CardsMoved' && e.from === 'draw' ? e.cardIds : []));
    expect(redrawn.length).toBeGreaterThan(0);
    expect(redrawn.every((id) => byId.get(id)!.exerciseId === null || measureOf.get(byId.get(id)!.exerciseId!) === 'seconds')).toBe(true);
    for (const ids of tableDeals) {
      for (const p of PLAYERS) {
        const got = state.tasks.filter((t) => t.playerId === p && t.cardIds.some((c) => ids.includes(c))).flatMap((t) => t.cardIds);
        expect(got.sort()).toEqual([...ids].sort());
      }
    }
    const wins = events.filter((e) => e.type === 'RoundWon');
    expect(wins.map((e) => e.type === 'RoundWon' && e.round)).toEqual([1, 2, 3, 4, 5]);
    expect(state.scores).toEqual({ p1: 5, p2: 0, p3: 0 }); // the script finishes p1's tasks first
  });
});

describe('rep-race with a judge', () => {
  const result = play('rep-race', { judge: true }, SEED, PLAYERS);

  it('matches the recorded event log', async () => {
    expectWellFormed(result, 54);
    await expect(pretty(result.events)).toMatchFileSnapshot(logFile('rep-race-judge.3p'));
  });

  it('the judge rotates by round, gets no tasks, and may mark another player done', () => {
    const { events, state } = result;
    const rounds = new Map<number, string[]>();
    let round = 0;
    for (const e of events) {
      if (e.type === 'CardsDealt' && e.zone === 'table') round++;
      if (e.type === 'TaskAssigned') rounds.set(round, [...(rounds.get(round) ?? []), e.task.playerId]);
    }
    // Round n is judged by seat (n-1) % 3, so only the other two work.
    for (const [n, workers] of rounds) {
      const judge = PLAYERS[(n - 1) % PLAYERS.length];
      expect(new Set(workers)).toEqual(new Set(PLAYERS.filter((p) => p !== judge)));
    }
    expect(state.scores['p1']).toBeLessThan(5); // p1 judges rounds 1 and 4, so can't win them
  });
});

describe('neighbor-rush golden log', () => {
  const result = play('neighbor-rush', {}, SEED, PLAYERS);

  it('matches the recorded event log', async () => {
    expectWellFormed(result, 54);
    await expect(pretty(result.events)).toMatchFileSnapshot(logFile('neighbor-rush.3p'));
  });

  it('every accepted play fits the center by suit or neighboring rank; leftovers go to their owners', () => {
    const { events, intents, state } = result;
    let center = events.find((e) => e.type === 'CardFlipped' && e.zone === 'table');
    expect(center).toBeDefined();
    let top = center!.type === 'CardFlipped' ? center!.cardId : '';
    let plays = 0;
    for (const e of events) {
      if (e.type !== 'CardsMoved' || e.to !== 'table') continue;
      const [played] = e.cardIds;
      const a = byId.get(played)!;
      const b = byId.get(top)!;
      const d = Math.abs(RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank));
      const adjacent = RANKS.indexOf(a.rank) >= 0 && RANKS.indexOf(b.rank) >= 0 && (d === 1 || d === 12);
      expect(a.suit === b.suit || adjacent, `${played} onto ${top}`).toBe(true);
      top = played;
      plays++;
    }
    expect(plays).toBe(intents.filter((i) => i.type === 'play').length);
    // End: someone emptied their hand, or the draw ran out and the last $players intents were passes.
    const emptied = PLAYERS.some((p) => state.zones.hands[p].length === 0);
    const lastTurnIntents = intents.filter((i) => i.type === 'play' || i.type === 'pass').slice(-PLAYERS.length);
    const stuck = state.zones.draw.length === 0 && lastTurnIntents.every((i) => i.type === 'pass');
    expect(emptied || stuck).toBe(true);
    for (const t of state.tasks) {
      expect(state.zones.hands[t.playerId]).toEqual(expect.arrayContaining(t.cardIds));
    }
  });
});

// ── Hidden-hand games ───────────────────────────────────────────────────────

describe('fit-poker golden log', () => {
  const result = play('fit-poker', {}, SEED, PLAYERS);

  it('matches the recorded event log', async () => {
    expectWellFormed(result, 54);
    await expect(pretty(result.events)).toMatchFileSnapshot(logFile('fit-poker.3p'));
  });

  it('each hand: showdown winners hold the best hand among players still in; losers work the pot; folds stay hidden', async () => {
    const { evaluatePoker, comparePoker } = await import('../poker');
    const { events } = result;
    let hands = new Map<string, string[]>();
    let folded = new Set<string>();
    let pot = 0;
    let checkedHands = 0;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.type === 'CardsDealt' && e.zone.startsWith('hand:')) {
        if (e === events.find((x, j) => j >= i && x.type === 'CardsDealt' && x.zone === 'hand:p1')) {
          hands = new Map();
          folded = new Set();
          pot = 0;
        }
        hands.set(e.zone.slice(5), e.cardIds);
      }
      if (e.type === 'PlayerFolded') folded.add(e.playerId);
      if (e.type === 'BetPlaced') pot = e.pot;
      if (e.type === 'CardsRevealed') {
        for (const p of folded) expect(e.cardIds.some((id) => hands.get(p)!.includes(id))).toBe(false);
        const live = [...hands].filter(([p]) => !folded.has(p)).map(([p, ids]) => ({ p, hand: evaluatePoker(ids.map((id) => byId.get(id)!)) }));
        const best = live.reduce((a, b) => (comparePoker(b.hand, a.hand) > 0 ? b : a)).hand;
        const expectedWinners = live.filter((h) => comparePoker(h.hand, best) === 0).map((h) => h.p);
        const winners: string[] = [];
        const potTasks = new Map<string, number>();
        for (let j = i + 1; j < events.length && (events[j].type === 'RoundWon' || events[j].type === 'TaskAssigned'); j++) {
          const ev = events[j];
          if (ev.type === 'RoundWon') winners.push(ev.playerId);
          if (ev.type === 'TaskAssigned') potTasks.set(ev.task.playerId, ev.task.amount / (ev.task.measure === 'seconds' ? 5 : 1));
        }
        expect(winners).toEqual(PLAYERS.filter((p) => expectedWinners.includes(p)));
        const losers = PLAYERS.filter((p) => !expectedWinners.includes(p));
        if (pot > 0) expect(Object.fromEntries(potTasks)).toEqual(Object.fromEntries(losers.map((p) => [p, pot])));
        else expect(potTasks.size).toBe(0);
        checkedHands++;
      }
    }
    expect(checkedHands).toBe(3);
  });
});

describe('bluff-pile golden log', () => {
  const result = play('bluff-pile', {}, SEED, PLAYERS);

  it('matches the recorded event log', async () => {
    expectWellFormed(result, 54, { cardsReassigned: true });
    await expect(pretty(result.events)).toMatchFileSnapshot(logFile('bluff-pile.3p'));
  });

  it('every challenge is judged from the revealed cards, the loser works the pile, and the winner emptied their hand', () => {
    const { events, state } = result;
    let pile: string[] = [];
    let lastClaim: { playerId: string; rank: string } | null = null;
    let challenges = 0;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.type === 'CardsMoved' && e.to === 'table') pile = [...pile, ...e.cardIds];
      if (e.type === 'ClaimMade') lastClaim = { playerId: e.playerId, rank: e.rank };
      if (e.type === 'CardsRevealed' && lastClaim) {
        const lied = e.cardIds.some((id) => byId.get(id)!.suit !== 'joker' && byId.get(id)!.rank !== lastClaim!.rank);
        const verdict = events[i + 1];
        expect(verdict).toMatchObject({ type: 'ClaimChallenged', claimant: lastClaim.playerId, lied });
        const loser = verdict.type === 'ClaimChallenged' ? verdict.loser : '';
        expect(loser).toBe(lied ? lastClaim.playerId : verdict.type === 'ClaimChallenged' ? verdict.playerId : '');
        const worked = events.slice(i + 2).filter((x, k, arr) => x.type === 'TaskAssigned' && arr.slice(0, k).every((y) => y.type === 'TaskAssigned'));
        expect(worked.flatMap((x) => (x.type === 'TaskAssigned' ? x.task.cardIds : [])).sort()).toEqual(
          pile.filter((id) => byId.get(id)!.exerciseId).sort(),
        );
        pile = [];
        lastClaim = null;
        challenges++;
      }
    }
    expect(challenges).toBeGreaterThan(0);
    const [winner] = events.filter((e) => e.type === 'RoundWon').map((e) => (e.type === 'RoundWon' ? e.playerId : ''));
    expect(state.zones.hands[winner]).toEqual([]);
    expect(state.scores[winner]).toBe(1);
  });
});

describe('team-relay golden log', () => {
  const FOUR = ['p1', 'p2', 'p3', 'p4'];
  const result = play('team-relay', {}, SEED, FOUR);

  it('matches the recorded event log', async () => {
    expectWellFormed(result, 54);
    await expect(pretty(result.events)).toMatchFileSnapshot(logFile('team-relay.4p'));
  });

  it('teams (p1+p3, p2+p4) share a hand, teammates alternate, and the emptied team wins', () => {
    const { events, state } = result;
    const dealt = events.flatMap((e) => (e.type === 'CardsDealt' ? [e.zone] : []));
    expect(dealt).toEqual(['hand:p1', 'hand:p2']); // captains hold the team hands
    const workers = events.flatMap((e) => (e.type === 'TaskAssigned' ? [e.task.playerId] : []));
    const team = (p: string) => (p === 'p1' || p === 'p3' ? 'A' : 'B');
    const byTeam = { A: workers.filter((p) => team(p) === 'A'), B: workers.filter((p) => team(p) === 'B') };
    for (const seq of Object.values(byTeam)) for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
    const winners = events.flatMap((e) => (e.type === 'RoundWon' ? [e.playerId] : []));
    expect(winners.length).toBe(2);
    expect(new Set(winners.map(team)).size).toBe(1);
    expect(state.zones.hands[winners[0] === 'p1' || winners[0] === 'p3' ? 'p1' : 'p2']).toEqual([]);
  });
});
