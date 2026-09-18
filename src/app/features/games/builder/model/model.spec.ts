import { loadContent } from '../../../../../testing/db';
import { createDslRules } from '../../../../domain/engine/dsl/interpreter';
import { dryRun, SECONDS_PER_REP } from '../../../../domain/engine/dsl/dry-run';
import { resolveSettings } from '../../../../domain/engine/dsl/settings';
import { createContext, createInitialState, reduce } from '../../../../domain/engine/reducer';
import { newBlock, toStep } from './blocks';
import {
  blankDraft, draftFromGame, duplicateBlock, findBlock, gameJson, getList, insertBlock, isInside, locate, moveBlock,
  removeBlock, setChildList, setGame, updateBlock, type GameDraft,
} from './draft';
import { addSetting, numberSettingFor, removeSetting, settingUses, suggestSettingKey } from './settings';
import { fieldProblems, validateDraft } from './validation';

const content = loadContent();
const deck = content.decks.decks.find((d) => d.id === 'deck-bodyweight')!;
const exercises = content.exercises.exercises;

describe('builder draft ↔ game JSON', () => {
  it.each(content.games.games.map((g) => [g.id, g] as const))('%s round-trips exactly and validates', (_id, game) => {
    const draft = draftFromGame(game);
    expect(gameJson(draft)).toEqual(game);
    const v = validateDraft(draft);
    expect(v.problems).toEqual([]);
    expect(v.game).toEqual(game);
  });

  it('keeps only the slots a game declares', () => {
    const duel = draftFromGame(content.games.games.find((g) => g.id === 'high-card-duel')!);
    expect(Object.keys(duel.slots).sort()).toEqual(['setup.deal', 'turn.each', 'turn.then']);
    const solo = setGame(duel, { ...duel.game, turn: { steps: [] } });
    expect(Object.keys(solo.slots).sort()).toEqual(['setup.deal', 'turn.steps']);
  });
});

describe('block tree operations', () => {
  function sample(): { draft: GameDraft; ifUid: string; flipUid: string; assignUid: string } {
    let draft = blankDraft('game-x');
    const [flip, assign] = draft.slots['turn.steps']!;
    const cond = newBlock('if');
    draft = insertBlock(draft, { slot: 'turn.steps' }, 2, cond);
    return { draft, ifUid: cond.uid, flipUid: flip.uid, assignUid: assign.uid };
  }

  it('moves blocks between top-level and nested lists, preserving order', () => {
    const { draft, ifUid, assignUid } = sample();
    const moved = moveBlock(draft, assignUid, { uid: ifUid, child: 'then' }, 0);
    expect(gameJson(moved)['turn']).toEqual({ steps: [{ flip: {} }, { if: 'draw.empty', then: [{ assign: 'table.last' }] }] });
    expect(locate(moved, assignUid)).toEqual({ ref: { uid: ifUid, child: 'then' }, index: 0 });
    const back = moveBlock(moved, assignUid, { slot: 'turn.steps' }, 0);
    expect(gameJson(back)['turn']).toEqual({ steps: [{ assign: 'table.last' }, { flip: {} }, { if: 'draw.empty', then: [] }] });
  });

  it('never drops a block into itself or its descendants', () => {
    const inner = newBlock('repeat');
    const draft = insertBlock(sample().draft, { slot: 'turn.steps' }, 0, inner);
    const d2 = insertBlock(draft, { uid: inner.uid, child: 'steps' }, 0, newBlock('if'));
    const nestedIf = getList(d2, { uid: inner.uid, child: 'steps' })![0];
    expect(isInside(d2, { uid: nestedIf.uid, child: 'then' }, inner.uid)).toBe(true);
    expect(moveBlock(d2, inner.uid, { uid: nestedIf.uid, child: 'then' }, 0)).toBe(d2);
    expect(isInside(d2, { slot: 'turn.steps' }, inner.uid)).toBe(false);
  });

  it('adds and removes an else list, updates bodies, duplicates with fresh ids, removes', () => {
    const { draft, ifUid, flipUid } = sample();
    let d = setChildList(draft, ifUid, 'else', []);
    d = insertBlock(d, { uid: ifUid, child: 'else' }, 0, newBlock('turn'));
    d = updateBlock(d, ifUid, { if: { count: 'table', gte: 3 } });
    expect((gameJson(d)['turn'] as { steps: unknown[] }).steps[2]).toEqual({ if: { count: 'table', gte: 3 }, then: [], else: [{ turn: 'next' }] });
    d = duplicateBlock(d, ifUid);
    const steps = getList(d, { slot: 'turn.steps' })!;
    expect(steps).toHaveLength(4);
    expect(steps[3].uid).not.toBe(ifUid);
    expect(steps[3].children.else![0].uid).not.toBe(findBlock(d, ifUid)!.children.else![0].uid);
    expect(toStep(steps[3])).toEqual(toStep(steps[2]));
    d = setChildList(removeBlock(d, flipUid), ifUid, 'else', undefined);
    expect((gameJson(d)['turn'] as { steps: unknown[] }).steps[1]).toEqual({ if: { count: 'table', gte: 3 }, then: [] });
  });
});

describe('validation pinned to blocks', () => {
  it('a bad value deep inside nested if/then/else lands on that block only', () => {
    let draft = blankDraft('game-x');
    const outer = newBlock('if');
    const inner = newBlock('if');
    const deal = newBlock('deal');
    draft = insertBlock(draft, { slot: 'turn.steps' }, 0, outer);
    draft = setChildList(draft, outer.uid, 'else', []);
    draft = insertBlock(draft, { uid: outer.uid, child: 'else' }, 0, inner);
    draft = insertBlock(draft, { uid: inner.uid, child: 'then' }, 0, deal);
    draft = updateBlock(draft, deal.uid, { deal: { to: 'tabel', count: -2 } });

    const v = validateDraft(draft);
    expect(v.game).toBeNull();
    expect([...v.byBlock.keys()]).toEqual([deal.uid]);
    expect(v.byBlock.get(deal.uid)!.join(' | ')).toMatch(/to: .*table.*\| count: Too small/);
    expect(v.problems.filter((p) => 'field' in p)).toEqual([]);
  });

  it('a condition problem lands on its if block with a readable path', () => {
    let draft = blankDraft('game-x');
    const cond = newBlock('if');
    draft = insertBlock(draft, { slot: 'turn.steps' }, 0, cond);
    draft = updateBlock(draft, cond.uid, { if: { all: [{ count: 'table', gte: 2, lt: 5 }, { flag: '' }] } });
    expect(validateDraft(draft).byBlock.get(cond.uid)).toEqual([
      'condition 1: count needs exactly one comparison',
      'condition 2: flag: Too small: expected string to have >=1 characters',
    ]);
  });

  it('an empty repeat and an unknown setting reference are pinned to their blocks', () => {
    let draft = blankDraft('game-x');
    const rep = newBlock('repeat');
    draft = insertBlock(draft, { slot: 'turn.steps' }, 0, rep);
    draft = setChildList(draft, rep.uid, 'steps', []);
    const [flip] = getList(draft, { slot: 'turn.steps' })!.slice(1);
    const refill = newBlock('refill');
    draft = insertBlock(draft, { slot: 'turn.steps' }, 1, refill);
    draft = updateBlock(draft, refill.uid, { refill: { zone: 'table', to: { setting: 'rowSize' } } });
    const v = validateDraft(draft);
    expect(v.byBlock.get(rep.uid)).toEqual(['Add at least one step to repeat.']);
    expect(v.byBlock.get(refill.uid)).toEqual(['to.setting: unknown setting "rowSize"']);
    expect(v.byBlock.has(flip.uid)).toBe(false);
  });

  it('game-level problems land on their fields', () => {
    const draft = blankDraft('game-x');
    const bad = setGame(draft, { ...draft.game, name: '', players: { min: 3, max: 2 }, turn: undefined });
    const v = validateDraft({ ...bad, slots: {} });
    expect(fieldProblems(v, 'name')).toHaveLength(1);
    expect(fieldProblems(v, 'players').length).toBeGreaterThan(0);
    expect(fieldProblems(v, 'turn')).toEqual(['a game needs a turn, actions, or bluff rules']);
  });
});

describe('settings exposure', () => {
  it('exposes a value as a setting and inlines the default when the setting is removed', () => {
    let draft = blankDraft('game-x');
    const refill = newBlock('refill');
    draft = insertBlock(draft, { slot: 'turn.steps' }, 2, refill);
    const key = suggestSettingKey('Row size', draft);
    expect(key).toBe('rowSize');
    draft = addSetting(draft, key, numberSettingFor(4, 'Row size'));
    draft = updateBlock(draft, refill.uid, { refill: { zone: 'table', to: { setting: key } } });
    expect(settingUses(draft, key)).toBe(1);
    expect(validateDraft(draft).problems).toEqual([]);
    expect(resolveSettings(validateDraft(draft).game!)['rowSize']).toBe(4);
    expect(suggestSettingKey('Row size', draft)).toBe('rowSize2');
    expect(suggestSettingKey('Rounds', draft)).toBe('rounds2'); // core keys are taken

    const removed = removeSetting(draft, key);
    if (!('draft' in removed)) throw new Error('expected removal');
    expect(removed.draft.game.settingsSchema).toEqual({});
    expect(findBlock(removed.draft, refill.uid)!.body).toEqual({ refill: { zone: 'table', to: 4 } });
  });

  it('refuses to remove a referenced setting that is off by default', () => {
    let draft = addSetting(blankDraft('game-x'), 'cap', { type: 'number', min: 1, max: 60, default: null, label: 'Cap' });
    const timer = newBlock('timer');
    draft = insertBlock(draft, { slot: 'setup.deal' }, 0, timer);
    draft = updateBlock(draft, timer.uid, { timer: { id: 'cap', kind: 'countdown', seconds: { setting: 'cap' } } });
    expect(removeSetting(draft, 'cap')).toEqual({ error: '“Cap” is used in 1 place and has no default to put back.' });
  });
});

describe('dry run', () => {
  it('plays 20 seeded turns through the real engine and estimates the work', () => {
    const def = content.games.games.find((g) => g.id === 'solo-deal')!;
    const run = dryRun({ def, deck, exercises, seed: 7 });
    expect(run.error).toBeNull();
    expect(run.turns).toBe(20);
    expect(run.events.filter((e) => e.type === 'CardFlipped').length).toBe(20);
    const done = run.state!.tasks.filter((t) => t.status === 'done');
    const reps = done.filter((t) => t.kind !== 'rest' && t.measure === 'reps').reduce((n, t) => n + t.amount, 0);
    const secs = done.filter((t) => t.kind !== 'rest' && t.measure === 'seconds').reduce((n, t) => n + t.amount, 0);
    const rest = done.filter((t) => t.kind === 'rest').reduce((n, t) => n + t.amount, 0);
    expect(run.total).toEqual({ reps, seconds: secs, restSeconds: rest, totalSeconds: reps * SECONDS_PER_REP + secs + rest });
    expect(run.perPlayer['p1']).toEqual(run.total);
    expect(dryRun({ def, deck, exercises, seed: 7 }).events).toEqual(run.events); // seeded
    expect(dryRun({ def, deck, exercises, seed: 8 }).events).not.toEqual(run.events);
  });

  it('a game built in the editor runs on the same engine the play screen uses', () => {
    let draft = blankDraft('game-built');
    const refill = newBlock('refill');
    draft = insertBlock(draft, { slot: 'setup.deal' }, 0, refill);
    draft = updateBlock(draft, refill.uid, { refill: { zone: 'table', to: 2 } });
    const def = validateDraft(draft).game!;
    expect(def).not.toBeNull();

    const settings = resolveSettings(def);
    const ctx = createContext(deck, exercises, settings, createDslRules(def));
    const dealt = reduce(createInitialState({ players: ['p1'], seed: 3, deck }), { type: 'deal', playerId: 'p1' }, ctx);
    expect(dealt.state.zones.table).toHaveLength(2);
    const run = dryRun({ def, deck, exercises, seed: 3, players: 1 });
    expect(run.events.slice(0, dealt.events.length)).toEqual(dealt.events);
  });

  it('reports a game the scripted players can’t play instead of throwing', () => {
    let draft = blankDraft('game-stuck');
    for (const b of draft.slots['turn.steps']!) draft = removeBlock(draft, b.uid);
    draft = insertBlock(draft, { slot: 'turn.steps' }, 0, newBlock('turn'));
    draft = setGame(draft, { ...draft.game, players: { min: 2, max: 2 } });
    const def = validateDraft(draft).game!;
    const run = dryRun({ def, deck, exercises, seed: 1, players: 2 });
    expect(run.error).toBeNull();
    expect(run.turns).toBe(20);
    expect(run.finished).toBe(false); // passes the turn forever: 20 turns, no work
    expect(run.total.totalSeconds).toBe(0);

    const poker = content.games.games.find((g) => g.id === 'fit-poker')!;
    const broken = dryRun({ def: poker, deck, exercises, seed: 1, settings: { maxBet: 999 } });
    expect(broken.error).toMatch(/Invalid settings for fit-poker: maxBet/);
    expect(broken.events).toEqual([]);
  });
});
