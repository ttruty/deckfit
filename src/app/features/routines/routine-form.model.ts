import { resolveSettings } from '../../domain/engine/dsl/settings';
import type { DeckFilters } from '../../domain/models/deck-rules';
import type { GameDefinition, SettingDef } from '../../domain/models/game.schema';
import { SUITS, type Difficulty, type Equipment, type Intensity, type JokerRule, type Routine, type Suit } from '../../domain/models/schemas';

export type SettingValue = string | number | boolean | Suit[] | null;

export interface RoutineFormValue {
  name: string;
  deckId: string;
  gameId: string;
  favorite: boolean;
  core: { intensity: Intensity; repMultiplier: number; faceCardValue: number; aceValue: number; jokerRule: JokerRule; maxRepCap: number | null };
  game: Record<string, SettingValue>;
  filters: { suits: Suit[]; maxDifficulty: Difficulty | null; limitEquipment: boolean; equipment: Equipment[] };
}

export const REP_MULTIPLIERS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3] as const;

/** Initial form value: from an existing routine, else the game's resolved defaults. */
export function toFormValue(routine: Routine | undefined, game: GameDefinition, fallbackDeckId: string): RoutineFormValue {
  const settings = resolveSettings(game, routine?.gameId === game.id ? routine.settings : undefined);
  const filters = routine?.deckFilters;
  return {
    name: routine?.name ?? '',
    deckId: routine?.deckId ?? fallbackDeckId,
    gameId: game.id,
    favorite: routine?.favorite ?? false,
    core: {
      intensity: settings.intensity ?? 'moderate',
      repMultiplier: settings.repMultiplier,
      faceCardValue: settings.faceCardValue,
      aceValue: settings.aceValue,
      jokerRule: settings.jokerRule,
      maxRepCap: settings.maxRepCap ?? null,
    },
    game: gameSettingValues(game, settings),
    filters: {
      suits: filters?.suits ?? [...SUITS],
      maxDifficulty: (filters?.maxDifficulty as Difficulty | undefined) ?? null,
      limitEquipment: filters?.equipment !== undefined,
      equipment: filters?.equipment ?? [],
    },
  };
}

/** Values for the game-specific controls; `current` wins when valid for the setting, else its default. */
export function gameSettingValues(game: GameDefinition, current: Record<string, unknown> = {}): Record<string, SettingValue> {
  return Object.fromEntries(
    Object.entries(game.settingsSchema).map(([key, def]) => [key, coerce(def, current[key])]),
  );
}

function coerce(def: SettingDef, value: unknown): SettingValue {
  switch (def.type) {
    case 'enum':
      return typeof value === 'string' && def.options.includes(value) ? value : def.default;
    case 'number':
      return typeof value === 'number' && value >= def.min && value <= def.max ? value : def.default;
    case 'boolean':
      return typeof value === 'boolean' ? value : def.default;
    case 'suits':
      return Array.isArray(value) && value.length && value.every((v) => (SUITS as readonly unknown[]).includes(v)) ? (value as Suit[]) : [...def.default];
  }
}

/** Deck filters only where they narrow something. */
export function toDeckFilters(f: RoutineFormValue['filters']): DeckFilters | undefined {
  const out: DeckFilters = {};
  if (f.suits.length < SUITS.length) out.suits = [...f.suits];
  if (f.maxDifficulty !== null) out.maxDifficulty = f.maxDifficulty;
  if (f.limitEquipment) out.equipment = [...f.equipment];
  return Object.keys(out).length ? out : undefined;
}

/** Builds a validated Routine. Throws (via resolveSettings) if game settings are invalid. */
export function toRoutine(value: RoutineFormValue, game: GameDefinition, id: string): Routine {
  const settings = resolveSettings(game, {
    intensity: value.core.intensity,
    repMultiplier: value.core.repMultiplier,
    faceCardValue: value.core.faceCardValue,
    aceValue: value.core.aceValue,
    jokerRule: value.core.jokerRule,
    ...(value.core.maxRepCap === null ? {} : { maxRepCap: value.core.maxRepCap }),
    ...Object.fromEntries(Object.entries(value.game).filter(([, v]) => v !== null)),
  });
  const deckFilters = toDeckFilters(value.filters);
  return {
    id,
    name: value.name.trim(),
    deckId: value.deckId,
    gameId: value.gameId,
    settings,
    ...(deckFilters ? { deckFilters } : {}),
    favorite: value.favorite,
    updatedAt: Date.now(),
  };
}
