import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { defaultBaseAmount } from '../../domain/models/deck-rules';
import type { Card, Exercise, ExerciseCategory, MuscleGroup } from '../../domain/models/schemas';
import { CATEGORY_LABEL, DIFFICULTY_LABEL, MEASURE_LABEL, SUIT_SYMBOL } from '../../shared/labels';
import { ExerciseFigureComponent } from '../../shared/ui/exercise-figure/exercise-figure.component';
import { NO_FILTERS, filterExercises } from '../library/exercise-filter';

export interface ExercisePickerData {
  card: Card;
  suitLabel: string;
  suitMuscleGroups: MuscleGroup[];
  deckCategory?: ExerciseCategory;
  exercises: Exercise[];
}

export interface ExercisePickerResult {
  exerciseId: string;
  baseAmount: number;
}

@Component({
  selector: 'df-exercise-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule,
    MatSlideToggleModule, ExerciseFigureComponent,
  ],
  template: `
    <h2 mat-dialog-title>
      {{ data.card.rank }} <span class="pip" [attr.data-suit]="data.card.suit" aria-hidden="true">{{ symbol }}</span>
      {{ data.suitLabel }}
    </h2>
    <mat-dialog-content class="content">
      <div class="controls">
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-icon matPrefix>search</mat-icon>
          <mat-label>Search</mat-label>
          <input #q matInput type="search" (input)="query.set(q.value)" cdkFocusInitial />
        </mat-form-field>
        @if (data.suitMuscleGroups.length) {
          <mat-slide-toggle [checked]="onlySuitGroups()" (change)="onlySuitGroups.set($event.checked)">
            Only {{ data.suitLabel }} muscle groups
          </mat-slide-toggle>
        }
        @if (data.deckCategory) {
          <mat-slide-toggle [checked]="onlyCategory()" (change)="onlyCategory.set($event.checked)">
            Only {{ categoryLabel }}
          </mat-slide-toggle>
        }
      </div>

      <div class="list" role="listbox" aria-label="Exercises" tabindex="-1">
        @for (ex of results(); track ex.id) {
          <button type="button" class="option" role="option" [attr.aria-selected]="ex.id === selectedId()"
                  [class.selected]="ex.id === selectedId()" (click)="select(ex)">
            <df-exercise-figure class="thumb" [figure]="ex.figure" aria-hidden="true" />
            <span class="text">
              <span class="name">{{ ex.name }}</span>
              <span class="meta">
                {{ difficulty[ex.difficulty] }} · {{ measure[ex.measure] }}@if (!ex.builtIn) { <span class="mine">Yours</span> }
              </span>
            </span>
            @if (ex.id === selectedId()) { <mat-icon class="check">check_circle</mat-icon> }
          </button>
        } @empty {
          <p class="empty">No exercises match.</p>
        }
      </div>
      @if (hiddenByFilters(); as hidden) {
        <button mat-button type="button" class="show-all" (click)="showAll()">
          {{ hidden }} more {{ hidden === 1 ? 'exercise matches' : 'exercises match' }} outside these filters — show all
        </button>
      }

      <mat-form-field appearance="outline" class="amount">
        <mat-label>Amount ({{ selectedMeasureLabel() }})</mat-label>
        <input matInput type="number" inputmode="numeric" min="1" max="999" [formControl]="amount" />
        <mat-hint>Before the game's multiplier</mat-hint>
        @if (amount.invalid) { <mat-error>Whole number from 1 to 999</mat-error> }
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button [disabled]="!selectedId() || amount.invalid" (click)="save()">Use this exercise</button>
    </mat-dialog-actions>
  `,
  styles: `
    .content { display: grid; gap: 12px; max-height: min(70vh, 640px); }
    .controls { display: grid; gap: 8px; padding-top: 4px; }
    .list { display: grid; align-content: start; gap: 4px; overflow-y: auto; max-height: 40vh; min-height: 160px; }
    .pip { color: var(--suit-text-hearts); }
    .pip[data-suit='diamonds'] { color: var(--suit-text-diamonds); }
    .pip[data-suit='clubs'] { color: var(--suit-text-clubs); }
    .pip[data-suit='spades'] { color: var(--suit-text-spades); }
    .option {
      --suit: var(--mat-sys-primary);
      display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 4px 8px; text-align: left;
      border: 1px solid transparent; border-radius: 12px; background: none; color: inherit; font: inherit; cursor: pointer;
      &:hover { background: var(--mat-sys-surface-container-high); }
      &.selected { border-color: var(--mat-sys-primary); background: var(--mat-sys-secondary-container); }
      &:focus-visible { outline: 2px solid var(--mat-sys-primary); }
    }
    .thumb { width: 48px; height: 48px; flex: none; }
    .text { display: grid; flex: 1; }
    .name { font: var(--mat-sys-title-small); }
    .meta { font: var(--mat-sys-body-small); color: var(--mat-sys-on-surface-variant); }
    .mine { margin-left: 6px; padding: 0 6px; border-radius: 8px; background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); }
    .check { color: var(--mat-sys-primary); }
    .amount { max-width: 220px; }
    .empty { padding: 16px 8px; }
  `,
})
export class ExercisePickerDialog {
  protected readonly data = inject<ExercisePickerData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<ExercisePickerDialog, ExercisePickerResult>>(MatDialogRef);

  protected readonly symbol = SUIT_SYMBOL[this.data.card.suit];
  protected readonly categoryLabel = this.data.deckCategory ? CATEGORY_LABEL[this.data.deckCategory] : '';
  protected readonly difficulty = DIFFICULTY_LABEL;
  protected readonly measure = MEASURE_LABEL;

  protected readonly query = signal('');
  protected readonly onlySuitGroups = signal(this.data.suitMuscleGroups.length > 0);
  protected readonly onlyCategory = signal(!!this.data.deckCategory);
  protected readonly selectedId = signal<string | null>(this.data.card.exerciseId);

  /** Matches the search but hidden by the suit/category toggles (e.g. an exercise you just made). */
  protected readonly hiddenByFilters = computed(() => {
    const all = filterExercises(this.data.exercises, { ...NO_FILTERS, query: this.query() });
    return all.length - this.results().length;
  });

  protected showAll(): void {
    this.onlySuitGroups.set(false);
    this.onlyCategory.set(false);
  }

  protected readonly amount = new FormControl<number>(this.data.card.baseAmount, {
    nonNullable: true,
    validators: [Validators.required, Validators.min(1), Validators.max(999), Validators.pattern(/^\d+$/)],
  });

  protected readonly results = computed(() => {
    const list = filterExercises(this.data.exercises, {
      ...NO_FILTERS,
      query: this.query(),
      muscleGroups: this.onlySuitGroups() ? this.data.suitMuscleGroups : [],
      category: this.onlyCategory() ? (this.data.deckCategory ?? null) : null,
    });
    // Keep the current choice visible even when filters would hide it.
    const current = this.data.exercises.find((e) => e.id === this.selectedId());
    return current && !list.includes(current) ? [current, ...list] : list;
  });

  protected readonly selectedMeasureLabel = computed(() => {
    const ex = this.data.exercises.find((e) => e.id === this.selectedId());
    return ex?.measure === 'seconds' ? 'seconds' : 'reps';
  });

  protected select(ex: Exercise): void {
    const previous = this.data.exercises.find((e) => e.id === this.selectedId());
    this.selectedId.set(ex.id);
    // Reset to the rank default unless the user already changed the amount by hand.
    if (!this.amount.dirty || previous?.measure !== ex.measure) {
      this.amount.setValue(defaultBaseAmount(this.data.card.rank, ex.measure));
      this.amount.markAsPristine();
    }
  }

  protected save(): void {
    const exerciseId = this.selectedId();
    if (!exerciseId || this.amount.invalid) return;
    this.ref.close({ exerciseId, baseAmount: this.amount.value });
  }
}
