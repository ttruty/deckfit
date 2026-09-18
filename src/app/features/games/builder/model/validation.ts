import type { z } from 'zod';
import {
  CONDITION_SCHEMAS, GameDefinitionSchema, STEP_SCHEMAS, type ConditionKind, type GameDefinition,
} from '../../../../domain/models/game.schema';
import { toStep, type Block } from './blocks';
import { allBlocks, pathKey, serializeDraft, type GameDraft } from './draft';

/** A problem pinned to a block (`uid`) or to a game-level field (dot path, e.g. `players.max`). */
export type Problem = { uid: string; message: string } | { field: string; message: string };

export interface DraftValidation {
  /** The parsed definition when everything is valid. */
  game: GameDefinition | null;
  problems: Problem[];
  /** Problems per block uid, for rendering. */
  byBlock: Map<string, string[]>;
}

type Issue = z.core.$ZodIssue;

/** Picks the most specific message out of a (possibly nested) union failure. */
function leaf(issue: Issue): Issue & { fullPath: PropertyKey[] } {
  if (issue.code !== 'invalid_union' || !issue.errors.length) return { ...issue, fullPath: issue.path };
  // Prefer the branch that got furthest: fewest "wrong shape" issues, then fewest issues.
  const score = (branch: Issue[]) =>
    branch.filter((i) => i.code === 'invalid_type' || i.code === 'unrecognized_keys' || i.code === 'invalid_value').length * 100 + branch.length;
  const best = [...issue.errors].sort((a, b) => score(a) - score(b))[0];
  const inner = leaf(best[0]);
  return { ...inner, fullPath: [...issue.path, ...inner.fullPath] };
}

/** "count: Too small …", with the step's own key dropped from the path. */
function describe(issue: Issue, dropFirst?: string): string {
  const l = leaf(issue);
  const path = l.fullPath.filter((p): p is string | number => typeof p !== 'symbol');
  const shown = path[0] === dropFirst ? path.slice(1) : path;
  const where = shown.filter((p) => typeof p === 'string').join('.');
  return where ? `${where}: ${l.message}` : l.message;
}

export function conditionKind(cond: unknown): ConditionKind | null {
  if (typeof cond === 'string') return 'empty';
  if (!cond || typeof cond !== 'object' || Array.isArray(cond)) return null;
  const keys = Object.keys(cond);
  if (keys.includes('equals')) return 'setting';
  return (Object.keys(CONDITION_SCHEMAS) as ConditionKind[]).find((k) => k !== 'empty' && keys.includes(k)) ?? null;
}

/** Messages for a condition tree, validating each node by its own kind (clear messages for nested all/any/not). */
export function conditionProblems(cond: unknown, prefix = 'condition'): string[] {
  const kind = conditionKind(cond);
  if (!kind) return [`${prefix}: choose a condition`];
  if (kind === 'all' || kind === 'any') {
    const list = (cond as Record<string, unknown>)[kind];
    if (!Array.isArray(list) || !list.length) return [`${prefix}: “${kind}” needs at least one condition`];
    return list.flatMap((c, i) => conditionProblems(c, `${prefix} ${i + 1}`));
  }
  if (kind === 'not') return conditionProblems((cond as Record<string, unknown>)['not'], `${prefix} (not)`);
  const parsed = CONDITION_SCHEMAS[kind].safeParse(cond);
  return parsed.success ? [] : parsed.error.issues.map((i) => `${prefix}: ${describe(i)}`);
}

/** Problems of one block on its own (children are checked as blocks of their own). */
export function blockProblems(block: Block): string[] {
  const step = toStep({ ...block, children: {} }) as unknown as Record<string, unknown>;
  if (block.kind === 'if') {
    step['then'] = [];
    if (block.children.else) step['else'] = [];
    const cond = conditionProblems(step['if']);
    if (cond.length) return cond;
  }
  if (block.kind === 'repeat') {
    step['steps'] = block.children.steps?.length ? [{ turn: 'next' }] : [];
    if (!block.children.steps?.length) return ['Add at least one step to repeat.'];
  }
  const parsed = STEP_SCHEMAS[block.kind].safeParse(step);
  return parsed.success ? [] : parsed.error.issues.map((i) => describe(i, block.kind));
}

/**
 * Validates the whole draft. Every block is checked on its own so errors land on the offending
 * block; then the full GameDefinitionSchema runs for game-level rules (players, end condition,
 * setting references…). Game-level issues that only echo an invalid block are dropped; custom
 * rules that point inside a block (e.g. an unknown setting) are pinned to that block.
 */
export function validateDraft(draft: GameDraft): DraftValidation {
  const byBlock = new Map<string, string[]>();
  const problems: Problem[] = [];
  const add = (p: Problem) => {
    if (problems.some((q) => q.message === p.message && ('uid' in q ? 'uid' in p && q.uid === p.uid : 'field' in p && q.field === p.field))) return;
    problems.push(p);
    if ('uid' in p) byBlock.set(p.uid, [...(byBlock.get(p.uid) ?? []), p.message]);
  };

  for (const block of allBlocks(draft)) for (const message of blockProblems(block)) add({ uid: block.uid, message });

  const { json, blockPaths, blockAt } = serializeDraft(draft);
  const parsed = GameDefinitionSchema.safeParse(json);
  if (parsed.success && !problems.length) return { game: parsed.data, problems, byBlock };

  const badPaths = [...byBlock.keys()].map((uid) => blockPaths.get(uid)!).filter(Boolean);
  for (const issue of parsed.success ? [] : parsed.error.issues) {
    const path = issue.path.filter((p): p is string | number => typeof p !== 'symbol');
    let uid: string | undefined;
    for (let n = path.length; n > 0 && !uid; n--) uid = blockAt.get(pathKey(path.slice(0, n)));
    if (uid) {
      const block = allBlocks(draft).find((b) => b.uid === uid)!;
      const inner = path.slice(blockPaths.get(uid)!.length);
      // Refinements inside a step were reported by blockProblems; game-level rules (setting references) were not.
      if (issue.code === 'custom' && !byBlock.has(uid)) add({ uid, message: describe({ ...issue, path: inner }, block.kind) });
      continue;
    }
    // A union over step lists fails whenever a block inside is invalid: that's already reported.
    if (badPaths.some((bp) => path.every((p, i) => bp[i] === p))) continue;
    add({ field: path.join('.'), message: describe({ ...issue, path: [] }) });
  }
  return { game: null, problems, byBlock };
}

/** Field problems whose path starts with `prefix` (e.g. `players`, `end.when`). */
export function fieldProblems(validation: DraftValidation, prefix: string): string[] {
  return validation.problems.flatMap((p) =>
    'field' in p && (p.field === prefix || p.field.startsWith(`${prefix}.`) || (prefix === '' && p.field === '')) ? [p.message] : [],
  );
}

/** `json` as it would be saved, if it passes (used by tests). */
export function parseDraft(draft: GameDraft): GameDefinition | null {
  return validateDraft(draft).game;
}

export { pathKey };
