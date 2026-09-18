import { DSL_ZONES, PICKS, PLAYER_ZONES, type ConditionKind } from '../../../../domain/models/game.schema';

export const ZONE_LABEL: Record<string, string> = {
  draw: 'Draw pile', discard: 'Discard pile', table: 'Table', hand: 'Hand (acting player)', pile: 'Pile (acting player)',
  team: 'Team hand (acting player)', hands: 'Every hand', piles: 'Every pile', teams: 'Every team hand',
};
export const PICK_LABEL: Record<string, string> = { first: 'first card', last: 'last card', middle: 'middle cards', all: 'all cards' };

export const SINGLE_ZONES = DSL_ZONES;
export const SELECTOR_ZONES = [...DSL_ZONES, ...PLAYER_ZONES] as const;
export const PICK_OPTIONS = PICKS;

export const CONDITION_LABEL: Record<ConditionKind, string> = {
  empty: 'Zone is empty',
  anyEmpty: 'Any hand / pile / team is empty',
  flag: 'Flag is set',
  match: 'Cards match',
  compare: 'Card beats card',
  count: 'Cards in zone',
  var: 'Counter',
  elapsed: 'Timer finished',
  setting: 'Setting equals',
  all: 'All of',
  any: 'Any of',
  not: 'Not',
};

export const CONDITION_DEFAULT: Record<ConditionKind, unknown> = {
  empty: 'draw.empty',
  anyEmpty: { anyEmpty: 'hands' },
  flag: { flag: 'betting' },
  match: { match: ['table.first', 'table.last'], on: 'suit' },
  compare: { compare: ['table.first', 'table.last'], wins: 'high' },
  count: { count: 'table', gte: 1 },
  var: { var: 'round', gte: 1 },
  elapsed: { elapsed: 'timer' },
  setting: { setting: '', equals: true },
  all: { all: ['draw.empty'] },
  any: { any: ['draw.empty'] },
  not: { not: 'draw.empty' },
};

export const COMPARISONS = [
  { op: 'lt', label: '<' }, { op: 'lte', label: '≤' }, { op: 'eq', label: '=' }, { op: 'gte', label: '≥' }, { op: 'gt', label: '>' },
] as const;

export const FLAG_SUGGESTIONS = ['betting', 'claim-open', 'bluff:winner', 'ending'];

/** Immutable set at a path; `undefined` removes the key. */
export function setIn<T extends Record<string, unknown>>(obj: T, path: readonly (string | number)[], value: unknown): T {
  const [head, ...rest] = path;
  const copy = (Array.isArray(obj) ? [...obj] : { ...obj }) as Record<string | number, unknown>;
  if (!rest.length) {
    if (value === undefined) delete copy[head];
    else copy[head] = value;
  } else {
    const child = copy[head];
    copy[head] = setIn((child && typeof child === 'object' ? child : typeof rest[0] === 'number' ? [] : {}) as Record<string, unknown>, rest, value);
  }
  return copy as T;
}
