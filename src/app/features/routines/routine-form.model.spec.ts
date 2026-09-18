import { loadContent } from '../../../testing/db';
import type { Routine } from '../../domain/models/schemas';
import { toDeckFilters, toFormValue, toRoutine, gameSettingValues } from './routine-form.model';

const { games } = loadContent().games;
const soloDeal = games.find((g) => g.id === 'solo-deal')!;
const endMatch = games.find((g) => g.id === 'end-match')!;

describe('routine form model', () => {
  it('new routine: game defaults, all suits, no filters', () => {
    const v = toFormValue(undefined, endMatch, 'deck-bodyweight');
    expect(v).toEqual({
      name: '', deckId: 'deck-bodyweight', gameId: 'end-match', favorite: false,
      core: { repMultiplier: 1, faceCardValue: 10, aceValue: 11, jokerRule: 'rest', maxRepCap: null },
      game: { matchOn: 'suit' },
      filters: { suits: ['hearts', 'diamonds', 'clubs', 'spades', 'joker'], maxDifficulty: null, limitEquipment: false, equipment: [] },
    });
    expect(toDeckFilters(v.filters)).toBeUndefined();
  });

  it('round-trips a routine through the form value', () => {
    const routine: Routine = {
      id: 'r1', name: 'Legs day', deckId: 'deck-dumbbell', gameId: 'solo-deal', favorite: true, updatedAt: 1,
      settings: {
        repMultiplier: 1.5, faceCardValue: 12, aceValue: 15, jokerRule: 'bonus-cardio', maxRepCap: 30,
        players: { min: 1, max: 1 }, suits: ['hearts', 'joker'], timeLimitSec: 600,
      },
      deckFilters: { maxDifficulty: 2, equipment: ['dumbbell'] },
    };
    const value = toFormValue(routine, soloDeal, 'ignored');
    expect(value.core).toEqual({ repMultiplier: 1.5, faceCardValue: 12, aceValue: 15, jokerRule: 'bonus-cardio', maxRepCap: 30 });
    expect(value.game).toEqual({ suits: ['hearts', 'joker'], timeLimitSec: 600 });
    expect(value.filters).toMatchObject({ maxDifficulty: 2, limitEquipment: true, equipment: ['dumbbell'] });
    const back = toRoutine(value, soloDeal, 'r1');
    expect({ ...back, updatedAt: 1 }).toEqual(routine);
  });

  it('switching games keeps valid shared values and defaults the rest', () => {
    expect(gameSettingValues(endMatch, { matchOn: 'color' })).toEqual({ matchOn: 'color' });
    expect(gameSettingValues(endMatch, { matchOn: 'adjacent-rank' })).toEqual({ matchOn: 'suit' });
    expect(gameSettingValues(soloDeal, { timeLimitSec: 5 })).toEqual({ suits: ['hearts', 'diamonds', 'clubs', 'spades', 'joker'], timeLimitSec: null });
  });

  it('null "off" values and empty caps are omitted from saved settings', () => {
    const value = toFormValue(undefined, soloDeal, 'deck-bodyweight');
    const routine = toRoutine({ ...value, name: '  Quick  ' }, soloDeal, 'r2');
    expect(routine.name).toBe('Quick');
    expect('timeLimitSec' in routine.settings).toBe(false);
    expect('maxRepCap' in routine.settings).toBe(false);
    expect(routine.deckFilters).toBeUndefined();
  });

  it('keeps only narrowing deck filters', () => {
    const base = { suits: ['hearts', 'diamonds', 'clubs', 'spades', 'joker'] as const, maxDifficulty: null, limitEquipment: false, equipment: [] };
    expect(toDeckFilters({ ...base, suits: ['hearts'] })).toEqual({ suits: ['hearts'] });
    expect(toDeckFilters({ ...base, suits: [...base.suits], limitEquipment: true })).toEqual({ equipment: [] });
    expect(toDeckFilters({ ...base, suits: [...base.suits], maxDifficulty: 3 })).toEqual({ maxDifficulty: 3 });
  });

  it('rejects invalid game settings', () => {
    const value = toFormValue(undefined, endMatch, 'deck-bodyweight');
    expect(() => toRoutine({ ...value, game: { matchOn: 'nope' } }, endMatch, 'r3')).toThrow(/matchOn/);
  });
});
