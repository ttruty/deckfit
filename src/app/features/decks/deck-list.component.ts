import { ChangeDetectionStrategy, Component, computed, inject, resource } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DeckRepository, ExerciseRepository } from '../../core/db/repositories';
import type { Deck } from '../../domain/models/schemas';
import { CATEGORY_LABEL, SUIT_NAME, SUIT_SYMBOL } from '../../shared/labels';
import { CardFaceComponent } from '../../shared/ui/card-face/card-face.component';
import { buildDeck } from '../../domain/models/deck-rules';
import { toCardFaceModel } from '../../shared/ui/card-face/card-face-model';

@Component({
  selector: 'df-deck-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButtonModule, MatIconModule, CardFaceComponent],
  templateUrl: './deck-list.component.html',
  styleUrl: './deck-list.component.scss',
})
export class DeckListComponent {
  private readonly decks = inject(DeckRepository);
  private readonly exercises = inject(ExerciseRepository);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);

  protected readonly data = resource({
    loader: async () => {
      const [decks, exercises] = await Promise.all([this.decks.list(), this.exercises.list()]);
      return { decks, exercisesById: new Map(exercises.map((e) => [e.id, e])) };
    },
  });

  protected readonly sections = computed(() => {
    const data = this.data.value();
    if (!data) return [];
    const view = (deck: Deck) => {
      // One card the deck could deal, as a taste of it. The seed is the deck's own id, so the
      // list doesn't reshuffle itself every time you look at it.
      const cards = buildDeck(deck, data.exercisesById, sampleSeed(deck.id));
      const card = cards.find((c) => c.suit === 'hearts') ?? cards.find((c) => c.exerciseId);
      const pool = deck.suits.reduce((n, s) => n + s.exerciseIds.length, 0);
      return {
        deck,
        preview: card ? toCardFaceModel(card, deck, data.exercisesById) : null,
        category: deck.category ? CATEGORY_LABEL[deck.category] : null,
        suits: deck.suits.filter((s) => s.suit !== 'joker').map((s) => ({ symbol: SUIT_SYMBOL[s.suit], name: SUIT_NAME[s.suit], label: s.label, suit: s.suit, count: s.exerciseIds.length })),
        exerciseCount: pool,
        cardCount: cards.length,
      };
    };
    const byName = (a: Deck, b: Deck) => a.name.localeCompare(b.name);
    const mine = data.decks.filter((d) => !d.builtIn).sort((a, b) => b.updatedAt - a.updatedAt).map(view);
    const builtIn = data.decks.filter((d) => d.builtIn).sort(byName).map(view);
    return [
      { id: 'mine', title: 'Your decks', decks: mine, empty: 'Duplicate a built-in deck to make your own.' },
      { id: 'built-in', title: 'Built-in decks', decks: builtIn, empty: 'No built-in decks loaded.' },
    ];
  });

  protected async duplicate(deck: Deck): Promise<void> {
    const copy = await this.decks.duplicate(deck.id);
    await this.router.navigate(['/decks', copy.id, 'edit']);
  }

  protected async remove(deck: Deck): Promise<void> {
    await this.decks.delete(deck.id);
    this.data.reload();
    const ref = this.snack.open(`Deleted “${deck.name}”`, 'Undo', { duration: 6000 });
    const undone = await firstValueFrom(ref.afterDismissed());
    if (undone.dismissedByAction) {
      await this.decks.save(deck);
      this.data.reload();
    }
  }
}

/** A stable seed per deck, so a deck's sample card is the same card every time it is listed. */
function sampleSeed(deckId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < deckId.length; i++) hash = Math.imul(hash ^ deckId.charCodeAt(i), 16777619);
  return hash >>> 0;
}
