import { STEP_KINDS, type Step, type StepKind } from '../../../../domain/models/game.schema';

/** Child step lists a block can own: `if` → then/else, `repeat` → steps. */
export type ChildSlot = 'then' | 'else' | 'steps';

/**
 * One DSL step in the editor. `body` is the step's JSON without its child step lists, so any step
 * (including hand-written ones) round-trips exactly; `children` holds the nested blocks.
 * An `else` list that is absent stays absent (`children.else === undefined`).
 */
export interface Block {
  uid: string;
  kind: StepKind;
  body: Record<string, unknown>;
  children: Partial<Record<ChildSlot, Block[]>>;
}

export type BlockGroup = 'Cards' | 'Tasks' | 'Flow' | 'Scoring' | 'Hidden info';

export interface PrimitiveInfo {
  kind: StepKind;
  label: string;
  icon: string;
  group: BlockGroup;
  help: string;
  /** A valid starting step. */
  create(): Step;
  /** Child lists this kind owns, in display order (`else` is optional). */
  childSlots: ChildSlot[];
}

/** The palette: every DSL primitive, with defaults that validate as-is. */
export const PRIMITIVES: readonly PrimitiveInfo[] = [
  { kind: 'deal', label: 'Deal', icon: 'style', group: 'Cards', help: 'Deal cards from the draw pile to a zone, or to every hand, pile, or team.', create: () => ({ deal: { to: 'table', count: 1 } }), childSlots: [] },
  { kind: 'flip', label: 'Flip', icon: 'flip', group: 'Cards', help: 'Turn the top card of the draw pile face up onto the table (or a zone).', create: () => ({ flip: {} }), childSlots: [] },
  { kind: 'move', label: 'Move', icon: 'open_with', group: 'Cards', help: 'Move selected cards to a zone.', create: () => ({ move: 'table.all', to: 'discard' }), childSlots: [] },
  { kind: 'refill', label: 'Refill', icon: 'playlist_add', group: 'Cards', help: 'Deal until a zone holds this many cards.', create: () => ({ refill: { zone: 'table', to: 4 } }), childSlots: [] },
  { kind: 'reshuffle', label: 'Reshuffle', icon: 'shuffle', group: 'Cards', help: 'Shuffle the discard pile back into the draw pile.', create: () => ({ reshuffle: true }), childSlots: [] },
  { kind: 'assign', label: 'Assign exercise', icon: 'fitness_center', group: 'Tasks', help: 'Give players the exercises on the selected cards.', create: () => ({ assign: 'table.last' }), childSlots: [] },
  { kind: 'timer', label: 'Timer', icon: 'timer', group: 'Tasks', help: 'Start a countdown or a work/rest interval.', create: () => ({ timer: { id: 'timer', kind: 'countdown', seconds: 60 } }), childSlots: [] },
  { kind: 'turn', label: 'Next player', icon: 'redo', group: 'Flow', help: 'Pass the turn to the next player.', create: () => ({ turn: 'next' }), childSlots: [] },
  { kind: 'if', label: 'If / then / else', icon: 'call_split', group: 'Flow', help: 'Run steps only when a condition holds.', create: () => ({ if: 'draw.empty', then: [] }), childSlots: ['then', 'else'] },
  { kind: 'repeat', label: 'Repeat', icon: 'repeat', group: 'Flow', help: 'Run steps several times.', create: () => ({ repeat: 2, steps: [{ turn: 'next' }] }), childSlots: ['steps'] },
  { kind: 'incr', label: 'Count up', icon: 'exposure_plus_1', group: 'Flow', help: 'Add to a named counter (e.g. rounds).', create: () => ({ incr: 'round' }), childSlots: [] },
  { kind: 'reset', label: 'Reset counter', icon: 'restart_alt', group: 'Flow', help: 'Set a counter back to 0.', create: () => ({ reset: 'round' }), childSlots: [] },
  { kind: 'winners', label: 'Pick winners', icon: 'emoji_events', group: 'Scoring', help: 'Decide who wins the round (high/low card, poker hand, or empty team hand).', create: () => ({ winners: { cards: 'hands.first', wins: 'high' } }), childSlots: [] },
  { kind: 'reveal', label: 'Reveal', icon: 'visibility', group: 'Hidden info', help: 'Turn cards face up for everyone (e.g. a showdown).', create: () => ({ reveal: 'hands.all' }), childSlots: [] },
  { kind: 'startBetting', label: 'Start betting', icon: 'toll', group: 'Hidden info', help: 'Open a betting round (needs the game’s betting rules).', create: () => ({ startBetting: true }), childSlots: [] },
  { kind: 'assignPot', label: 'Losers work the pot', icon: 'savings', group: 'Hidden info', help: 'Everyone who lost the round works the betting pot.', create: () => ({ assignPot: { to: 'losers' } }), childSlots: [] },
];

export const PRIMITIVE: Record<StepKind, PrimitiveInfo> = Object.fromEntries(PRIMITIVES.map((p) => [p.kind, p])) as Record<StepKind, PrimitiveInfo>;

let nextUid = 0;
export const newUid = (): string => `b${++nextUid}`;

export function kindOf(step: object): StepKind {
  const kind = STEP_KINDS.find((k) => k in step);
  if (!kind) throw new Error(`Unknown step ${JSON.stringify(step)}`);
  return kind;
}

export function fromStep(step: Step): Block {
  const kind = kindOf(step);
  const { then, else: otherwise, steps, ...rest } = step as Record<string, unknown>;
  const children: Block['children'] = {};
  const body: Record<string, unknown> = { ...rest };
  if (kind === 'if') {
    children.then = fromSteps(then as Step[]);
    if (otherwise !== undefined) children.else = fromSteps(otherwise as Step[]);
  } else if (kind === 'repeat') {
    children.steps = fromSteps(steps as Step[]);
  } else {
    // Keys named like child slots only exist on if/repeat, but keep anything else intact.
    Object.assign(body, then === undefined ? {} : { then }, otherwise === undefined ? {} : { else: otherwise }, steps === undefined ? {} : { steps });
  }
  return { uid: newUid(), kind, body: structuredClone(body), children };
}

export const fromSteps = (steps: readonly Step[]): Block[] => steps.map(fromStep);

export function newBlock(kind: StepKind): Block {
  return fromStep(PRIMITIVE[kind].create());
}

/** Back to DSL JSON (unvalidated). */
export function toStep(block: Block): Step {
  const step: Record<string, unknown> = structuredClone(block.body);
  if (block.kind === 'if') {
    step['then'] = toSteps(block.children.then ?? []);
    if (block.children.else) step['else'] = toSteps(block.children.else);
  } else if (block.kind === 'repeat') {
    step['steps'] = toSteps(block.children.steps ?? []);
  }
  return step as Step;
}

export const toSteps = (blocks: readonly Block[]): Step[] => blocks.map(toStep);

/** A deep copy with fresh uids (duplicate, palette drops). */
export function cloneBlock(block: Block): Block {
  return {
    uid: newUid(), kind: block.kind, body: structuredClone(block.body),
    children: Object.fromEntries(Object.entries(block.children).map(([slot, list]) => [slot, list.map(cloneBlock)])),
  };
}

/** Every block in a list, depth first. */
export function* walkBlocks(blocks: readonly Block[]): Generator<Block> {
  for (const b of blocks) {
    yield b;
    for (const list of Object.values(b.children)) yield* walkBlocks(list);
  }
}
