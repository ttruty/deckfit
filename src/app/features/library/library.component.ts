import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { MatChipsModule, type MatChipListboxChange } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import type { Difficulty, Equipment, ExerciseCategory, Measure, MuscleGroup } from '../../domain/models/schemas';
import { CATEGORY_LABEL, DIFFICULTY_LABEL, EQUIPMENT_LABEL, MEASURE_LABEL, MUSCLE_LABEL, keysOf } from '../../shared/labels';
import { ExerciseTileComponent } from './exercise-tile.component';
import { LibraryStore } from './library.store';

@Component({
  selector: 'df-library',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButtonModule, MatChipsModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule, ExerciseTileComponent],
  templateUrl: './library.component.html',
  styleUrl: './library.component.scss',
})
export class LibraryComponent {
  protected readonly store = inject(LibraryStore);
  protected readonly showFilters = signal(false);

  protected readonly categories = keysOf(CATEGORY_LABEL);
  protected readonly muscles = keysOf(MUSCLE_LABEL);
  protected readonly equipment = keysOf(EQUIPMENT_LABEL);
  protected readonly measures = keysOf(MEASURE_LABEL);
  protected readonly difficulties: Difficulty[] = [1, 2, 3, 4, 5];
  protected readonly labels = { CATEGORY_LABEL, MUSCLE_LABEL, EQUIPMENT_LABEL, MEASURE_LABEL, DIFFICULTY_LABEL };

  constructor() {
    this.store.reload(); // pick up exercises added since the last visit
  }

  protected setQuery(value: string) {
    this.store.patch({ query: value });
  }
  protected setCategory(value: ExerciseCategory | null) {
    this.store.patch({ category: value });
  }
  protected setMuscles(e: MatChipListboxChange) {
    this.store.patch({ muscleGroups: e.value as MuscleGroup[] });
  }
  protected setEquipment(e: MatChipListboxChange) {
    this.store.patch({ equipment: e.value as Equipment[] });
  }
  protected setDifficulty(e: MatChipListboxChange) {
    this.store.patch({ maxDifficulty: (e.value as Difficulty | undefined) ?? null });
  }
  protected setMeasure(e: MatChipListboxChange) {
    this.store.patch({ measure: (e.value as Measure | undefined) ?? null });
  }
}
