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

  /** "Used in decks": each deck with the group it can be dealt from. */
  protected readonly usage = computed(() => {
    const id = this.exerciseId();
    return (this.data.value()?.decks ?? []).map((deck) => ({
      deck,
      where: deck.suits
        .filter((s) => s.exerciseIds.includes(id))
        .map((s) => ({ symbol: SUIT_SYMBOL[s.suit], name: SUIT_NAME[s.suit], label: s.label })),
    }));
  });

  protected readonly labels = { CATEGORY_LABEL, DIFFICULTY_LABEL, EQUIPMENT_LABEL, MEASURE_LABEL, MUSCLE_LABEL };
}
