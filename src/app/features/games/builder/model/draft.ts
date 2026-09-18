import type { GameDefinition, Step } from '../../../../domain/models/game.schema';
import { cloneBlock, fromSteps, toSteps, walkBlocks, type Block, type ChildSlot } from './blocks';

/** Top-level step lists of a game, by JSON path. */
export const SLOT_PATHS = {
  'setup.deal': ['setup', 'deal'],
  'turn.steps': ['turn', 'steps'],
  'turn.each': ['turn', 'each'],
  'turn.then': ['turn', 'then'],
  'actions.play.steps': ['actions', 'play', 'steps'],
  'actions.pass.steps': ['actions', 'pass', 'steps'],
  'betting.then': ['betting', 'then'],
  'end.then': ['end', 'then'],
} as const satisfies Record<string, readonly string[]>;
export type SlotId = keyof typeof SLOT_PATHS;
export const SLOT_IDS = Object.keys(SLOT_PATHS) as SlotId[];

/** Everything about a game except its step lists, as plain (possibly invalid) JSON. */
export type DraftGame = Record<string, unknown> & { settingsSchema: Record<string, Record<string, unknown>> };

/**
 * The builder's working copy. A slot exists in `slots` exactly when the game has that list (e.g.
 * `turn.each` only for simultaneous turns); `game` keeps an empty array at the slot's path.
 */
export interface GameDraft {
  game: DraftGame;
  slots: Partial<Record<SlotId, Block[]>>;
}

/** Where a list of blocks lives: a top-level slot, or a child list of a block. */
export type ListRef = { slot: SlotId } | { uid: string; child: ChildSlot };

export function listId(ref: ListRef): string {
  return 'slot' in ref ? `slot:${ref.slot}` : `block:${ref.uid}:${ref.child}`;
}

export function parseListId(id: string): ListRef | null {
  const [type, a, b] = id.split(':');
  if (type === 'slot' && a && a in SLOT_PATHS) return { slot: a as SlotId };
  if (type === 'block' && a && (b === 'then' || b === 'else' || b === 'steps')) return { uid: a, child: b };
  return null;
}

// ── Conversion ──────────────────────────────────────────────────────────────

export function getPath(obj: unknown, path: readonly (string | number)[]): unknown {
  return path.reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

function setPath(obj: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let o = obj;
  for (const k of path.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[path.at(-1)!] = value;
}

export function draftFromGame(def: GameDefinition): GameDraft {
  const game = structuredClone(def) as unknown as DraftGame;
  const slots: GameDraft['slots'] = {};
  for (const slot of SLOT_IDS) {
    const steps = getPath(game, SLOT_PATHS[slot]);
    if (!Array.isArray(steps)) continue;
    slots[slot] = fromSteps(steps as Step[]);
    setPath(game, SLOT_PATHS[slot], []);
  }
  return { game, slots };
}

export interface Serialized {
  json: Record<string, unknown>;
  /** JSON path of every block, and the block at every such path. */
  blockPaths: Map<string, (string | number)[]>;
  blockAt: Map<string, string>;
}

export const pathKey = (path: readonly (string | number)[]): string => JSON.stringify(path);

/** The candidate GameDefinition JSON (unvalidated), with block positions for error pinning. */
export function serializeDraft(draft: GameDraft): Serialized {
  const json = structuredClone(draft.game) as Record<string, unknown>;
  const blockPaths = new Map<string, (string | number)[]>();
  const blockAt = new Map<string, string>();
  const index = (blocks: readonly Block[], base: (string | number)[]) =>
    blocks.forEach((b, i) => {
      const path = [...base, i];
      blockPaths.set(b.uid, path);
      blockAt.set(pathKey(path), b.uid);
      for (const [child, list] of Object.entries(b.children)) index(list, [...path, child]);
    });
  for (const slot of SLOT_IDS) {
    const blocks = draft.slots[slot];
    if (!blocks || !Array.isArray(getPath(json, SLOT_PATHS[slot]))) continue;
    setPath(json, SLOT_PATHS[slot], toSteps(blocks));
    index(blocks, [...SLOT_PATHS[slot]]);
  }
  return { json, blockPaths, blockAt };
}

export function gameJson(draft: GameDraft): Record<string, unknown> {
  return serializeDraft(draft).json;
}

// ── Tree operations (immutable) ─────────────────────────────────────────────

function mapLists(draft: GameDraft, fn: (ref: ListRef, list: Block[]) => Block[]): GameDraft {
  const visit = (list: Block[], ref: ListRef): Block[] =>
    fn(ref, list).map((b) => ({
      ...b,
      children: Object.fromEntries(Object.entries(b.children).map(([child, l]) => [child, visit(l, { uid: b.uid, child: child as ChildSlot })])),
    }));
  const slots: GameDraft['slots'] = {};
  for (const [slot, list] of Object.entries(draft.slots) as [SlotId, Block[]][]) slots[slot] = visit(list, { slot });
  return { ...draft, slots };
}

const sameRef = (a: ListRef, b: ListRef) => listId(a) === listId(b);

export function allBlocks(draft: GameDraft): Block[] {
  return Object.values(draft.slots).flatMap((list) => [...walkBlocks(list)]);
}

export function findBlock(draft: GameDraft, uid: string): Block | undefined {
  return allBlocks(draft).find((b) => b.uid === uid);
}

export function getList(draft: GameDraft, ref: ListRef): Block[] | undefined {
  if ('slot' in ref) return draft.slots[ref.slot];
  return findBlock(draft, ref.uid)?.children[ref.child];
}

/** Where a block currently is. */
export function locate(draft: GameDraft, uid: string): { ref: ListRef; index: number } | null {
  let found: { ref: ListRef; index: number } | null = null;
  mapLists(draft, (ref, list) => {
    const index = list.findIndex((b) => b.uid === uid);
    if (index >= 0) found = { ref, index };
    return list;
  });
  return found;
}

export function insertBlock(draft: GameDraft, ref: ListRef, index: number, block: Block): GameDraft {
  return mapLists(draft, (r, list) => (sameRef(r, ref) ? [...list.slice(0, index), block, ...list.slice(index)] : list));
}

export function removeBlock(draft: GameDraft, uid: string): GameDraft {
  return mapLists(draft, (_, list) => list.filter((b) => b.uid !== uid));
}

/** Whether `ref` is inside block `uid` (a block can't be dropped into itself). */
export function isInside(draft: GameDraft, ref: ListRef, uid: string): boolean {
  if ('slot' in ref) return false;
  const block = findBlock(draft, uid);
  return !!block && [...walkBlocks([block])].some((b) => b.uid === ref.uid);
}

/** Moves a block to `index` of `ref` (index as in the target list after removal). No-op for impossible moves. */
export function moveBlock(draft: GameDraft, uid: string, ref: ListRef, index: number): GameDraft {
  const block = findBlock(draft, uid);
  if (!block || isInside(draft, ref, uid)) return draft;
  const removed = removeBlock(draft, uid);
  const target = getList(removed, ref);
  if (!target) return draft;
  return insertBlock(removed, ref, Math.max(0, Math.min(index, target.length)), block);
}

export function updateBlock(draft: GameDraft, uid: string, body: Record<string, unknown>): GameDraft {
  return mapLists(draft, (_, list) => list.map((b) => (b.uid === uid ? { ...b, body } : b)));
}

/** Adds (`[]`) or removes (`undefined`) an optional child list, e.g. an if's else. */
export function setChildList(draft: GameDraft, uid: string, child: ChildSlot, blocks: Block[] | undefined): GameDraft {
  return mapLists(draft, (_, list) =>
    list.map((b) => {
      if (b.uid !== uid) return b;
      const children = { ...b.children };
      if (blocks) children[child] = blocks;
      else delete children[child];
      return { ...b, children };
    }),
  );
}

export function duplicateBlock(draft: GameDraft, uid: string): GameDraft {
  const at = locate(draft, uid);
  const block = findBlock(draft, uid);
  return at && block ? insertBlock(draft, at.ref, at.index + 1, cloneBlock(block)) : draft;
}

/** Replaces the game part (everything but step lists), keeping `slots` in step with the lists it declares. */
export function setGame(draft: GameDraft, game: DraftGame): GameDraft {
  const slots: GameDraft['slots'] = {};
  for (const slot of SLOT_IDS) {
    if (!Array.isArray(getPath(game, SLOT_PATHS[slot]))) continue;
    slots[slot] = draft.slots[slot] ?? [];
  }
  return { game, slots };
}

/** An empty but runnable starting point for a new game. */
export function blankDraft(id: string): GameDraft {
  return draftFromGame({
    id, name: 'My game', summary: 'Flip a card, do the exercise.', players: { min: 1, max: 1 },
    setup: { shuffle: true, deal: [] },
    turn: { steps: [{ flip: {} }, { assign: 'table.last' }] },
    end: { when: 'draw.empty' },
    scoring: 'total-work',
    settingsSchema: {},
    builtIn: false,
  });
}
