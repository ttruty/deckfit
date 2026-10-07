import { Injectable, computed, inject, signal } from '@angular/core';
import { DeckRepository, ExerciseRepository } from '../../core/db/repositories';
import { PLAYING_SUITS, buildDeck, suggestPool } from '../../domain/models/deck-rules';
import type { Deck, Exercise, MuscleGroup, Suit } from '../../domain/models/schemas';
import { SUIT_NAME, SUIT_SYMBOL } from '../../shared/labels';
import { toCardFaceModel } from '../../shared/ui/card-face/card-face-model';

/** How many sample cards the preview deals, to show what the groups turn into. */
const SAMPLE_CARDS = 6;

/**
 * Draft state for one deck in the editor. Provided per editor instance.
 *
 * A deck is four groups of exercises (§9b) — there are no cards to edit, so the store's job is
 * adding and removing exercises, plus a sample deal so you can see what the groups make.
 */
@Injectable()
export class DeckEditorStore {
  private readonly decks = inject(DeckRepository);
  private readonly exerciseRepo = inject(ExerciseRepository);

  private readonly saved = signal<Deck | null>(null);
  readonly deck = signal<Deck | null>(null);
  readonly exercises = signal<Exercise[]>([]);
  readonly status = signal<'loading' | 'ready' | 'not-found'>('loading');
  readonly saving = signal(false);
  /** Re-deals the preview; bumped by "Shuffle" and whenever the groups change. */
  readonly sampleSeed = signal(1);

  readonly readOnly = computed(() => this.deck()?.builtIn ?? true);
  readonly dirty = computed(() => {
    const d = this.deck();
    return !!d && !d.builtIn && JSON.stringify(d) !== JSON.stringify(this.saved());
  });
  readonly exercisesById = computed(() => new Map(this.exercises().map((e) => [e.id, e])));
  /** False while every group is empty: there is nothing to deal, and nothing worth saving. */
  readonly empty = computed(() => !this.deck()?.suits.some((s) => s.suit !== 'joker' && s.exerciseIds.length));

  /** One row per playing suit: its label, muscle groups, and the exercises it can deal. */
  readonly groups = computed(() => {
    const deck = this.deck();
    if (!deck) return [];
    const byId = this.exercisesById();
    return PLAYING_SUITS.flatMap((suit) => {
      const mapping = deck.suits.find((s) => s.suit === suit);
      if (!mapping) return [];
      return [{
        suit,
        symbol: SUIT_SYMBOL[suit],
        name: SUIT_NAME[suit],
        label: mapping.label,
        muscleGroups: mapping.muscleGroups,
        exercises: mapping.exerciseIds.flatMap((id) => {
          const ex = byId.get(id);
          return ex ? [ex] : [];
        }),
        missing: mapping.exerciseIds.filter((id) => !byId.has(id)),
      }];
    });
  });

  /** A handful of cards this deck would deal right now, so the groups have a face. */
  readonly sample = computed(() => {
    const deck = this.deck();
    if (!deck || this.empty()) return [];
    const byId = this.exercisesById();
    const cards = buildDeck(deck, byId, this.sampleSeed());
    const step = Math.max(1, Math.floor(cards.filter((c) => c.exerciseId).length / SAMPLE_CARDS));
    return cards
      .filter((c) => c.exerciseId)
      .filter((_, i) => i % step === 0)
      .slice(0, SAMPLE_CARDS)
      .map((card) => toCardFaceModel(card, deck, byId));
  });

  async load(deckId: string): Promise<void> {
    this.status.set('loading');
    const [deck, exercises] = await Promise.all([this.decks.get(deckId), this.exerciseRepo.list()]);
    this.exercises.set(exercises);
    this.saved.set(deck ?? null);
    this.deck.set(deck ? structuredClone(deck) : null);
    this.status.set(deck ? 'ready' : 'not-found');
  }

  rename(name: string): void {
    this.edit((d) => ({ ...d, name }));
  }

  setSuit(suit: Suit, changes: { label?: string; muscleGroups?: MuscleGroup[] }): void {
    this.edit((d) => ({ ...d, suits: d.suits.map((s) => (s.suit === suit ? { ...s, ...changes } : s)) }));
  }

  /** Replaces a group's exercises (what the picker hands back), dropping repeats. */
  setPool(suit: Suit, exerciseIds: readonly string[]): void {
    this.editPool(suit, () => [...new Set(exerciseIds)]);
  }

  /** Adds exercises to a group, keeping the order they were picked in and ignoring repeats. */
  addExercises(suit: Suit, exerciseIds: readonly string[]): void {
    this.editPool(suit, (ids) => [...new Set([...ids, ...exerciseIds])]);
  }

  removeExercise(suit: Suit, exerciseId: string): void {
    this.editPool(suit, (ids) => ids.filter((id) => id !== exerciseId));
  }

  /** Fills a group with exercises that fit it. Returns an error message, or null on success. */
  suggest(suit: Suit): string | null {
    const deck = this.deck();
    if (!deck || deck.builtIn) return 'This deck is read-only.';
    const result = suggestPool(deck, suit, this.exercises());
    if (!result.ok) return result.reason;
    this.addExercises(suit, result.exercises.map((e) => e.id));
    return null;
  }

  reshuffleSample(): void {
    this.sampleSeed.update((n) => (n + 1) >>> 0);
  }

  discard(): void {
    const saved = this.saved();
    this.deck.set(saved ? structuredClone(saved) : null);
  }

  async save(): Promise<void> {
    const deck = this.deck();
    if (!deck || deck.builtIn) return;
    this.saving.set(true);
    try {
      const stored = await this.decks.save(deck);
      this.saved.set(stored);
      this.deck.set(structuredClone(stored));
    } finally {
      this.saving.set(false);
    }
  }

  /** Duplicates the current deck (as last saved) and returns the copy's id. */
  async duplicate(): Promise<string> {
    const deck = this.saved();
    if (!deck) throw new Error('No deck loaded');
    return (await this.decks.duplicate(deck.id)).id;
  }

  private editPool(suit: Suit, fn: (ids: string[]) => string[]): void {
    this.edit((d) => ({ ...d, suits: d.suits.map((s) => (s.suit === suit ? { ...s, exerciseIds: fn(s.exerciseIds) } : s)) }));
    this.reshuffleSample();
  }

  private edit(fn: (d: Deck) => Deck): void {
    const d = this.deck();
    if (!d || d.builtIn) return;
    this.deck.set(fn(d));
  }
}
