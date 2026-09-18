import { TestBed } from '@angular/core/testing';
import { DeckRepository } from '../../core/db/repositories';
import { seedContent } from '../../core/db/seed-content';
import { loadContent, provideTestDb } from '../../../testing/db';
import { DeckEditorStore } from './deck-editor.store';

describe('DeckEditorStore', () => {
  let store: DeckEditorStore;

  beforeEach(async () => {
    const db = provideTestDb();
    TestBed.configureTestingModule({ providers: [DeckEditorStore] });
    await seedContent(db, loadContent());
    store = TestBed.inject(DeckEditorStore);
  });

  it('loads a built-in deck read-only: edits are ignored and nothing is dirty', async () => {
    await store.load('deck-bodyweight');
    expect(store.status()).toBe('ready');
    expect(store.readOnly()).toBe(true);
    store.rename('Nope');
    store.setCard('bodyweight-hearts-2', 'bw-plank', 20);
    expect(store.deck()?.name).toBe('Bodyweight deck');
    expect(store.dirty()).toBe(false);
    expect(store.autoFill('hearts')).toBe('This deck is read-only.');
  });

  it('builds 5 rows (4 suits + jokers) with cards in rank order', async () => {
    await store.load('deck-bodyweight');
    const rows = store.rows();
    expect(rows.map((r) => [r.suit, r.label, r.cards.length])).toEqual([
      ['hearts', 'Legs', 13], ['diamonds', 'Push', 13], ['clubs', 'Pull', 13], ['spades', 'Core', 13], ['joker', 'Wild', 2],
    ]);
    expect(rows[0].cards.map((c) => c.card.rank)).toEqual(['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']);
    expect(rows[0].cards[0].face).toMatchObject({ suit: 'hearts', rank: '2', suitLabel: 'Legs', amount: 2, exercise: { name: 'Air Squat' } });
  });

  it('edits a copy, tracks dirty, discards, and saves to Dexie', async () => {
    const copy = await TestBed.inject(DeckRepository).duplicate('deck-bodyweight');
    await store.load(copy.id);
    expect(store.readOnly()).toBe(false);

    const cardId = copy.cards.find((c) => c.suit === 'hearts' && c.rank === '2')!.id;
    store.setCard(cardId, 'bw-reverse-lunge', 8);
    expect(store.dirty()).toBe(true);
    store.discard();
    expect(store.dirty()).toBe(false);

    store.setCard(cardId, 'bw-reverse-lunge', 8);
    store.setSuit('clubs', { label: 'Back', muscleGroups: ['back'] });
    await store.save();
    expect(store.dirty()).toBe(false);
    const stored = await TestBed.inject(DeckRepository).get(copy.id);
    expect(stored?.cards.find((c) => c.id === cardId)).toMatchObject({ exerciseId: 'bw-reverse-lunge', baseAmount: 8 });
    expect(stored?.suits.find((s) => s.suit === 'clubs')).toMatchObject({ label: 'Back', muscleGroups: ['back'] });
  });

  it('auto-fills a suit or explains why not', async () => {
    const copy = await TestBed.inject(DeckRepository).duplicate('deck-bodyweight');
    await store.load(copy.id);
    store.setSuit('spades', { muscleGroups: [] });
    expect(store.autoFill('spades')).toBe('Pick muscle groups for Core first.');
    store.setSuit('spades', { muscleGroups: ['core'] });
    expect(store.autoFill('spades')).toBeNull();
    const spades = store.rows().find((r) => r.suit === 'spades')!.cards;
    const tierIds = [spades[0], spades[4], spades[8]].map((c) => c.card.exerciseId);
    expect(new Set(tierIds).size).toBe(3);
  });

  it('reports a missing deck', async () => {
    await store.load('nope');
    expect(store.status()).toBe('not-found');
  });
});
