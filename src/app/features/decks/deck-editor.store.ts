import { Injectable, computed, inject, signal } from '@angular/core';
import { DeckRepository, ExerciseRepository } from '../../core/db/repositories';
import { PLAYING_RANKS, PLAYING_SUITS, autoFillSuit } from '../../domain/models/deck-rules';
import type { Card, Deck, Exercise, MuscleGroup, Suit } from '../../domain/models/schemas';
import { SUIT_NAME, SUIT_SYMBOL } from '../../shared/labels';
import { toCardFaceModel } from '../../shared/ui/card-face/card-face-model';

const SUIT_ORDER: Suit[] = [...PLAYING_SUITS, 'joker'];
const RANK_ORDER: string[] = [...PLAYING_RANKS, 'JOKER'];

/** Draft state for one deck in the editor. Provided per editor instance. */
@Injectable()
export class DeckEditorStore {
  private readonly decks = inject(DeckRepository);
  private readonly exerciseRepo = inject(ExerciseRepository);

  private readonly saved = signal<Deck | null>(null);
  readonly deck = signal<Deck | null>(null);
  readonly exercises = signal<Exercise[]>([]);
  readonly status = signal<'loading' | 'ready' | 'not-found'>('loading');
  readonly saving = signal(false);

  readonly readOnly = computed(() => this.deck()?.builtIn ?? true);
  readonly dirty = computed(() => {
    const d = this.deck();
    return !!d && !d.builtIn && JSON.stringify(d) !== JSON.stringify(this.saved());
  });
  readonly exercisesById = computed(() => new Map(this.exercises().map((e) => [e.id, e])));

  /** One row per suit present in the deck, cards in rank order, ready for CardFaceComponent. */
  readonly rows = computed(() => {
    const deck = this.deck();
    if (!deck) return [];
    const byId = this.exercisesById();
    return SUIT_ORDER.filter((suit) => deck.cards.some((c) => c.suit === suit)).map((suit) => ({
      suit,
      symbol: SUIT_SYMBOL[suit],
      name: SUIT_NAME[suit],
      label: deck.suits.find((s) => s.suit === suit)?.label ?? SUIT_NAME[suit],
      cards: deck.cards
        .filter((c) => c.suit === suit)
        .sort((a, b) => RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank))
        .map((card) => ({ card, face: toCardFaceModel(card, deck, byId) })),
    }));
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

  setCard(cardId: string, exerciseId: string, baseAmount: number): void {
    this.edit((d) => ({ ...d, cards: d.cards.map((c): Card => (c.id === cardId ? { ...c, exerciseId, baseAmount } : c)) }));
  }

  /** Returns an error message, or null on success. */
  autoFill(suit: Suit): string | null {
    const deck = this.deck();
    if (!deck || deck.builtIn) return 'This deck is read-only.';
    const result = autoFillSuit(deck, suit, this.exercises());
    if (!result.ok) return result.reason;
    this.edit((d) => ({ ...d, cards: result.cards }));
    return null;
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

  private edit(fn: (d: Deck) => Deck): void {
    const d = this.deck();
    if (!d || d.builtIn) return;
    this.deck.set(fn(d));
  }
}
