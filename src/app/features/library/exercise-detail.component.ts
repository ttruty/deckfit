import { ChangeDetectionStrategy, Component, computed, inject, input, resource } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { DeckRepository, ExerciseRepository } from '../../core/db/repositories';
import { ExerciseFigureComponent } from '../../shared/ui/exercise-figure/exercise-figure.component';
import { CATEGORY_LABEL, DIFFICULTY_LABEL, EQUIPMENT_LABEL, MEASURE_LABEL, MUSCLE_LABEL, SUIT_NAME, SUIT_SYMBOL } from '../../shared/labels';

@Component({
  selector: 'df-exercise-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButtonModule, MatChipsModule, MatIconModule, ExerciseFigureComponent],
  templateUrl: './exercise-detail.component.html',
  styleUrl: './exercise-detail.component.scss',
})
export class ExerciseDetailComponent {
  /** Route param. */
  readonly exerciseId = input.required<string>();

  private readonly exercises = inject(ExerciseRepository);
  private readonly decks = inject(DeckRepository);

  protected readonly data = resource({
    params: () => this.exerciseId(),
    loader: async ({ params: id }) => {
      const [exercise, decks] = await Promise.all([this.exercises.get(id), this.decks.usingExercise(id)]);
      return { exercise, decks };
    },
  });

  protected readonly exercise = computed(() => this.data.value()?.exercise);

  /** "Used in decks": each deck with the suit/ranks that carry this exercise. */
  protected readonly usage = computed(() => {
    const id = this.exerciseId();
    return (this.data.value()?.decks ?? []).map((deck) => {
      const cards = deck.cards.filter((c) => c.exerciseId === id);
      const suits = [...new Set(cards.map((c) => c.suit))];
      return {
        deck,
        where: suits.map((suit) => {
          const label = deck.suits.find((s) => s.suit === suit)?.label ?? SUIT_NAME[suit];
          const ranks = cards.filter((c) => c.suit === suit).map((c) => c.rank);
          return { symbol: SUIT_SYMBOL[suit], name: SUIT_NAME[suit], label, ranks: ranks.join(' ') };
        }),
      };
    });
  });

  protected readonly labels = { CATEGORY_LABEL, DIFFICULTY_LABEL, EQUIPMENT_LABEL, MEASURE_LABEL, MUSCLE_LABEL };
}
