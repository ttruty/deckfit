import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import type { Exercise, ExerciseCategory, MuscleGroup, Suit } from '../../domain/models/schemas';
import { CATEGORY_LABEL, DIFFICULTY_LABEL, MEASURE_LABEL, SUIT_SYMBOL } from '../../shared/labels';
import { ExerciseFigureComponent } from '../../shared/ui/exercise-figure/exercise-figure.component';
import { NO_FILTERS, filterExercises } from '../library/exercise-filter';

export interface ExercisePickerData {
  suit: Suit;
  /** The group's name in this deck, e.g. "Legs". */
  groupLabel: string;
  muscleGroups: MuscleGroup[];
  deckCategory?: ExerciseCategory;
  exercises: Exercise[];
  /** Already in the group: shown ticked, and unticking one takes it out. */
  selected: string[];
}

/** The exercise ids the group should hold when the dialog closes. */
export type ExercisePickerResult = string[];

/**
 * Picks the exercises a group can deal (§9b). Multi-select and nothing else: there is no card
 * and no amount to set — the deal decides those.
 */
@Component({
  selector: 'df-exercise-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule,
    MatSlideToggleModule, ExerciseFigureComponent,
  ],
  template: `
    <h2 mat-dialog-title>
      <span class="pip" [attr.data-suit]="data.suit" aria-hidden="true">{{ symbol }}</span>
      {{ data.groupLabel }}
    </h2>
    <mat-dialog-content class="content">
      <div class="controls">
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-icon matPrefix>search</mat-icon>
          <mat-label>Search</mat-label>
          <input #q matInput type="search" (input)="query.set(q.value)" cdkFocusInitial />
        </mat-form-field>
        @if (data.muscleGroups.length) {
          <mat-slide-toggle [checked]="onlyGroupMuscles()" (change)="onlyGroupMuscles.set($event.checked)">
            Only {{ data.groupLabel }} muscle groups
          </mat-slide-toggle>
        }
        @if (data.deckCategory) {
          <mat-slide-toggle [checked]="onlyCategory()" (change)="onlyCategory.set($event.checked)">
            Only {{ categoryLabel }}
          </mat-slide-toggle>
        }
      </div>

      <div class="list" role="group" [attr.aria-label]="'Exercises for ' + data.groupLabel">
        @for (ex of results(); track ex.id) {
          @let on = chosen().includes(ex.id);
          <button type="button" class="option" [attr.aria-pressed]="on" [class.selected]="on" (click)="toggle(ex.id)">
            <df-exercise-figure class="thumb" [figure]="ex.figure" aria-hidden="true" />
            <span class="text">
              <span class="name">{{ ex.name }}</span>
              <span class="meta">
                {{ difficulty[ex.difficulty] }} · {{ measure[ex.measure] }}@if (!ex.builtIn) { <span class="mine">Yours</span> }
              </span>
            </span>
            <mat-icon class="check" [class.off]="!on">{{ on ? 'check_circle' : 'add_circle_outline' }}</mat-icon>
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
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <p class="count" role="status">{{ chosen().length }} chosen</p>
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button (click)="save()">Done</button>
    </mat-dialog-actions>
  `,
  styles: `
    .content { display: grid; gap: 12px; max-height: min(70vh, 640px); }
    .controls { display: grid; gap: 8px; padding-top: 4px; }
    .list { display: grid; align-content: start; gap: 4px; overflow-y: auto; max-height: 46vh; min-height: 160px; }
    .pip { color: var(--suit-text-hearts); }
    .pip[data-suit='diamonds'] { color: var(--suit-text-diamonds); }
    .pip[data-suit='clubs'] { color: var(--suit-text-clubs); }
    .pip[data-suit='spades'] { color: var(--suit-text-spades); }
    .option {
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
    .check { color: var(--mat-sys-primary); &.off { color: var(--mat-sys-on-surface-variant); } }
    .count { margin: 0 auto 0 8px; font: var(--mat-sys-body-small); color: var(--mat-sys-on-surface-variant); }
    .empty { padding: 16px 8px; }
  `,
})
export class ExercisePickerDialog {
  protected readonly data = inject<ExercisePickerData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<ExercisePickerDialog, ExercisePickerResult>>(MatDialogRef);

  protected readonly symbol = SUIT_SYMBOL[this.data.suit];
  protected readonly categoryLabel = this.data.deckCategory ? CATEGORY_LABEL[this.data.deckCategory] : '';
  protected readonly difficulty = DIFFICULTY_LABEL;
  protected readonly measure = MEASURE_LABEL;

  protected readonly query = signal('');
  protected readonly onlyGroupMuscles = signal(this.data.muscleGroups.length > 0);
  protected readonly onlyCategory = signal(!!this.data.deckCategory);
  protected readonly chosen = signal<string[]>([...this.data.selected]);

  /** What the toggles leave, before anything is pinned to the top. */
  private readonly matches = computed(() =>
    filterExercises(this.data.exercises, {
      ...NO_FILTERS,
      query: this.query(),
      muscleGroups: this.onlyGroupMuscles() ? this.data.muscleGroups : [],
      category: this.onlyCategory() ? (this.data.deckCategory ?? null) : null,
    }),
  );

  protected readonly results = computed(() => {
    const list = this.matches();
    // With nothing typed, what's already in the group sits at the top whatever the filters say —
    // but a search is a search: it shows what was asked for, ticks and all.
    if (this.query().trim()) return list;
    const picked = this.data.exercises.filter((e) => this.chosen().includes(e.id) && !list.includes(e));
    return [...picked, ...list];
  });

  /** Matches the search but hidden by the group/category toggles (e.g. an exercise you just made). */
  protected readonly hiddenByFilters = computed(() => {
    const all = filterExercises(this.data.exercises, { ...NO_FILTERS, query: this.query() });
    return Math.max(0, all.length - this.matches().length);
  });

  protected showAll(): void {
    this.onlyGroupMuscles.set(false);
    this.onlyCategory.set(false);
  }

  protected toggle(id: string): void {
    this.chosen.update((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  protected save(): void {
    this.ref.close(this.chosen());
  }
}
