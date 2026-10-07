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
    store.addExercises('hearts', ['bw-plank']);
    expect(store.deck()?.name).toBe('Bodyweight deck');
    expect(store.dirty()).toBe(false);
    expect(store.suggest('hearts')).toBe('This deck is read-only.');
  });

  it('shows the four groups and what each can deal', async () => {
    await store.load('deck-bodyweight');
    expect(store.groups().map((g) => [g.suit, g.label, g.exercises.length])).toEqual([
      ['hearts', 'Legs', 3], ['diamonds', 'Push', 3], ['clubs', 'Pull', 3], ['spades', 'Core', 3],
    ]);
    expect(store.groups()[0].exercises.map((e) => e.name)).toContain('Air Squat');
    expect(store.empty()).toBe(false);
  });

  it('adds and removes exercises, tracks dirty, discards, and saves to Dexie', async () => {
    const copy = await TestBed.inject(DeckRepository).duplicate('deck-bodyweight');
    await store.load(copy.id);
    expect(store.readOnly()).toBe(false);

    store.addExercises('hearts', ['bw-plank']);
    expect(store.dirty()).toBe(true);
    store.discard();
    expect(store.dirty()).toBe(false);

    store.addExercises('hearts', ['bw-plank', 'bw-plank']); // the same one twice is still one
    store.removeExercise('hearts', 'bw-air-squat');
    store.setSuit('clubs', { label: 'Back', muscleGroups: ['back'] });
    await store.save();
    expect(store.dirty()).toBe(false);

    const stored = await TestBed.inject(DeckRepository).get(copy.id);
    expect(stored?.suits.find((s) => s.suit === 'hearts')?.exerciseIds).toEqual(['bw-reverse-lunge', 'bw-jump-squat', 'bw-plank']);
    expect(stored?.suits.find((s) => s.suit === 'clubs')).toMatchObject({ label: 'Back', muscleGroups: ['back'] });
  });

  it('setPool replaces a group, which is how the picker hands its answer back', async () => {
    const copy = await TestBed.inject(DeckRepository).duplicate('deck-bodyweight');
    await store.load(copy.id);
    store.setPool('spades', ['bw-plank', 'bw-air-squat', 'bw-plank']);
    expect(store.deck()?.suits.find((s) => s.suit === 'spades')?.exerciseIds).toEqual(['bw-plank', 'bw-air-squat']);
  });

  it('suggests exercises for an empty group, or explains why not', async () => {
    const copy = await TestBed.inject(DeckRepository).duplicate('deck-bodyweight');
    await store.load(copy.id);
    store.setPool('spades', []);
    store.setSuit('spades', { muscleGroups: [] });
    expect(store.suggest('spades')).toBe('Pick muscle groups for Core first.');
    store.setSuit('spades', { muscleGroups: ['core'] });
    expect(store.suggest('spades')).toBeNull();
    expect(store.groups().find((g) => g.suit === 'spades')!.exercises.length).toBe(3);
  });

  it('deals a sample that only uses the groups, and re-deals on demand', async () => {
    const copy = await TestBed.inject(DeckRepository).duplicate('deck-bodyweight');
    await store.load(copy.id);
    const names = new Set(store.groups().flatMap((g) => g.exercises.map((e) => e.name)));
    const sample = store.sample();
    expect(sample.length).toBeGreaterThan(0);
    expect(sample.every((face) => face.exercise && names.has(face.exercise.name))).toBe(true);

    const before = sample.map((f) => `${f.rank}${f.suit}${f.amount}`);
    store.reshuffleSample();
    // A different seed, so a different deal (the odds of an identical six are negligible).
    expect(store.sample().map((f) => `${f.rank}${f.suit}${f.amount}`)).not.toEqual(before);
  });

  it('an empty deck deals nothing and says so', async () => {
    const copy = await TestBed.inject(DeckRepository).duplicate('deck-bodyweight');
    await store.load(copy.id);
    for (const suit of ['hearts', 'diamonds', 'clubs', 'spades'] as const) store.setPool(suit, []);
    expect(store.empty()).toBe(true);
    expect(store.sample()).toEqual([]);
  });

  it('reports a missing deck', async () => {
    await store.load('nope');
    expect(store.status()).toBe('not-found');
  });
});
