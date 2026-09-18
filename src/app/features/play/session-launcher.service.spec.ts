import { TestBed } from '@angular/core/testing';
import { SessionRepository } from '../../core/db/repositories';
import { seedContent } from '../../core/db/seed-content';
import { IdentityService } from '../../core/identity/identity.service';
import { SessionSchema } from '../../domain/models/schemas';
import { loadContent, provideTestDb } from '../../../testing/db';
import { LaunchError, QUICK_START, SessionLauncher } from './session-launcher.service';

describe('SessionLauncher', () => {
  let launcher: SessionLauncher;

  beforeEach(async () => {
    const db = provideTestDb();
    await seedContent(db, loadContent());
    launcher = TestBed.inject(SessionLauncher);
  });

  it('quick start creates a schema-valid session with a deck snapshot, resolved settings, and me as player', async () => {
    const id = await launcher.start(QUICK_START);
    const session = (await TestBed.inject(SessionRepository).get(id))!;
    expect(SessionSchema.parse(session)).toEqual(session);
    const me = await TestBed.inject(IdentityService).me();
    expect(session).toMatchObject({
      game: { id: 'solo-deal', name: 'Solo Deal' },
      deck: { id: 'deck-bodyweight', name: 'Bodyweight deck' },
      settings: { repMultiplier: 1, jokerRule: 'rest', suits: ['hearts', 'diamonds', 'clubs', 'spades', 'joker'] },
      players: [me],
      log: [],
      totals: { [me.id]: {} },
    });
    expect(session.deck.cards).toHaveLength(54);
    expect(session.endedAt).toBeUndefined();
  });

  it('uses a fresh seed each time and keeps the same device identity', async () => {
    const repo = TestBed.inject(SessionRepository);
    const [a, b] = await Promise.all([launcher.start(QUICK_START), launcher.start(QUICK_START)]);
    const [sa, sb] = [(await repo.get(a))!, (await repo.get(b))!];
    expect(sa.seed).not.toBe(sb.seed);
    expect(sa.players[0].id).toBe(sb.players[0].id);
  });

  it('applies routine settings and deck filters', async () => {
    const id = await launcher.startRoutine({
      id: 'r1', name: 'Legs', deckId: 'deck-bodyweight', gameId: 'end-match', favorite: true, updatedAt: 0,
      settings: { repMultiplier: 2, faceCardValue: 8, aceValue: 12, jokerRule: 'skip', players: { min: 1, max: 1 }, matchOn: 'rank' },
      deckFilters: { suits: ['hearts', 'spades'] },
    });
    const session = (await TestBed.inject(SessionRepository).get(id))!;
    expect(session.routineId).toBe('r1');
    expect(session.settings).toMatchObject({ repMultiplier: 2, faceCardValue: 8, matchOn: 'rank' });
    expect(new Set(session.deck.cards.map((c) => c.suit))).toEqual(new Set(['hearts', 'spades']));
  });

  it('refuses unknown decks/games and filters that leave no exercises', async () => {
    await expect(launcher.start({ ...QUICK_START, deckId: 'nope' })).rejects.toThrow(LaunchError);
    await expect(launcher.start({ ...QUICK_START, gameId: 'nope' })).rejects.toThrow('That game no longer exists.');
    await expect(launcher.start({ ...QUICK_START, deckFilters: { suits: ['joker'] } })).rejects.toThrow(/No exercise cards/);
  });
});
