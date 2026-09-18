import { Injectable, computed, inject, resource, signal } from '@angular/core';
import { ExerciseRepository } from '../../core/db/repositories';
import { NO_FILTERS, activeFilterCount, filterExercises, type ExerciseFilters } from './exercise-filter';

/** Library state. Root-provided so filters survive a trip to the detail page and back. */
@Injectable({ providedIn: 'root' })
export class LibraryStore {
  private readonly repo = inject(ExerciseRepository);

  private readonly source = resource({ loader: () => this.repo.list() });
  readonly loading = this.source.isLoading;
  readonly error = this.source.error;

  readonly filters = signal<ExerciseFilters>(NO_FILTERS);
  readonly activeCount = computed(() => activeFilterCount(this.filters()));
  readonly total = computed(() => this.source.value()?.length ?? 0);
  readonly results = computed(() => filterExercises(this.source.value() ?? [], this.filters()));

  patch(changes: Partial<ExerciseFilters>): void {
    this.filters.update((f) => ({ ...f, ...changes }));
  }

  reset(): void {
    this.filters.set(NO_FILTERS);
  }

  reload(): void {
    this.source.reload();
  }
}
