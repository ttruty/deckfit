import type { GameDefinition, SettingDef, SettingRef } from '../../models/game.schema';
import { GameSettingsSchema, SuitSchema, type GameSettings } from '../../models/schemas';

/** Core defaults for any game; a game's `defaults` and then a routine's overrides win. */
export const BASE_SETTINGS = {
  repMultiplier: 1,
  faceCardValue: 10,
  aceValue: 11,
  jokerRule: 'rest',
} as const satisfies Partial<GameSettings>;

/** Resolved settings for a game: base → game defaults → settingsSchema defaults → overrides. */
export function resolveSettings(def: GameDefinition, overrides: Partial<GameSettings> = {}): GameSettings {
  const schemaDefaults = Object.fromEntries(
    Object.entries(def.settingsSchema)
      .filter(([, s]) => s.default !== null)
      .map(([key, s]) => [key, s.default]),
  );
  const merged = { ...BASE_SETTINGS, ...def.defaults, players: def.players, ...schemaDefaults, ...stripUndefined(overrides) };
  const core = GameSettingsSchema.parse(merged);
  const problems = validateGameSettings(def, core);
  if (problems.length) throw new Error(`Invalid settings for ${def.id}: ${problems.join('; ')}`);
  return core;
}

/** Checks game-specific keys against the game's settingsSchema. Returns human-readable problems. */
export function validateGameSettings(def: GameDefinition, settings: GameSettings): string[] {
  return Object.entries(def.settingsSchema).flatMap(([key, s]) => {
    const problem = checkSetting(s, settings[key]);
    return problem ? [`${key}: ${problem}`] : [];
  });
}

function checkSetting(def: SettingDef, value: unknown): string | null {
  switch (def.type) {
    case 'enum':
      return typeof value === 'string' && def.options.includes(value) ? null : `expected one of ${def.options.join('|')}`;
    case 'number':
      if (value === undefined || value === null) return def.default === null ? null : 'required';
      return typeof value === 'number' && value >= def.min && value <= def.max ? null : `expected ${def.min}..${def.max}`;
    case 'boolean':
      return typeof value === 'boolean' ? null : 'expected boolean';
    case 'suits':
      return Array.isArray(value) && value.length > 0 && value.every((v) => SuitSchema.safeParse(v).success) ? null : 'expected a non-empty suit list';
  }
}

/** Resolves a literal-or-{setting} value. Missing optional settings resolve to undefined. */
export function settingValue<T>(value: T | SettingRef, settings: GameSettings): T | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'setting' in value) {
    return settings[value.setting] as T | undefined;
  }
  return value as T;
}

/** Drops undefined/null so "off" optional settings (e.g. no time cap) don't override defaults or fail parsing. */
function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as Partial<T>;
}
