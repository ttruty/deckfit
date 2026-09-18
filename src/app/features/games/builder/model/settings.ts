import type { SettingDef } from '../../../../domain/models/game.schema';
import { CORE_SETTING_KEYS } from '../../../../domain/models/game.schema';
import type { Block } from './blocks';
import { allBlocks, type GameDraft, type SlotId } from './draft';

/** Setting keys a game may reference without declaring them. */
export const RESERVED_SETTING_KEYS: readonly string[] = [...CORE_SETTING_KEYS, 'timeLimitSec', 'rounds'];

function isRef(node: unknown, key: string): boolean {
  return !!node && typeof node === 'object' && !Array.isArray(node) && (node as Record<string, unknown>)['setting'] === key
    && Object.keys(node).length === 1;
}

/** Replaces every `{ "setting": key }` in `node` (not the `setting` of a setting-equals condition). */
function replaceRefs(node: unknown, key: string, value: unknown): { node: unknown; count: number } {
  if (isRef(node, key)) return { node: structuredClone(value), count: 1 };
  if (Array.isArray(node)) {
    let count = 0;
    const out = node.map((n) => {
      const r = replaceRefs(n, key, value);
      count += r.count;
      return r.node;
    });
    return { node: out, count };
  }
  if (node && typeof node === 'object') {
    let count = 0;
    const out = Object.fromEntries(Object.entries(node).map(([k, v]) => {
      const r = replaceRefs(v, key, value);
      count += r.count;
      return [k, r.node];
    }));
    return { node: out, count };
  }
  return { node, count: 0 };
}

/** How many places reference setting `key` (steps and game-level fields). */
export function settingUses(draft: GameDraft, key: string): number {
  const { settingsSchema, ...rest } = draft.game;
  void settingsSchema;
  return replaceRefs(rest, key, null).count + allBlocks(draft).reduce((n, b) => n + replaceRefs(b.body, key, null).count, 0);
}

/** A camelCase key from a label that doesn't collide with declared or core settings. */
export function suggestSettingKey(label: string, draft: GameDraft): string {
  const words = label.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  let base = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('') || 'setting';
  if (!/^[a-z]/.test(base)) base = `s${base}`;
  const taken = new Set([...Object.keys(draft.game.settingsSchema), ...RESERVED_SETTING_KEYS]);
  let key = base;
  for (let i = 2; taken.has(key); i++) key = `${base}${i}`;
  return key;
}

/** A number setting whose default is `value`, with a range that comfortably contains it. */
export function numberSettingFor(value: number, label: string): SettingDef {
  const max = Math.max(10, Math.ceil(value * 4));
  return { type: 'number', min: Math.min(0, value), max, step: 1, default: value, label };
}

export function addSetting(draft: GameDraft, key: string, def: SettingDef): GameDraft {
  return { ...draft, game: { ...draft.game, settingsSchema: { ...draft.game.settingsSchema, [key]: def as unknown as Record<string, unknown> } } };
}

export function updateSetting(draft: GameDraft, key: string, def: Record<string, unknown>): GameDraft {
  return addSetting(draft, key, def as unknown as SettingDef);
}

/**
 * Removes a setting. References are replaced by the setting's default so the game keeps working;
 * a referenced setting whose default is "off" (null) can't be removed (returns an error).
 */
export function removeSetting(draft: GameDraft, key: string): { draft: GameDraft } | { error: string } {
  const def = draft.game.settingsSchema[key];
  if (!def) return { draft };
  const uses = settingUses(draft, key);
  if (uses && (def['default'] === null || def['default'] === undefined)) {
    return { error: `“${String(def['label'] ?? key)}” is used in ${uses} ${uses === 1 ? 'place' : 'places'} and has no default to put back.` };
  }
  const { [key]: _removed, ...settingsSchema } = draft.game.settingsSchema;
  void _removed;
  const { settingsSchema: _old, ...rest } = draft.game;
  void _old;
  const game = { ...(replaceRefs(rest, key, def['default']).node as Record<string, unknown>), settingsSchema };
  const replaceInBlocks = (blocks: Block[]): Block[] =>
    blocks.map((b) => ({
      ...b,
      body: replaceRefs(b.body, key, def['default']).node as Record<string, unknown>,
      children: Object.fromEntries(Object.entries(b.children).map(([c, l]) => [c, replaceInBlocks(l)])),
    }));
  const next: GameDraft = { game, slots: {} };
  for (const [slot, list] of Object.entries(draft.slots) as [SlotId, Block[]][]) next.slots[slot] = replaceInBlocks(list);
  return { draft: next };
}
