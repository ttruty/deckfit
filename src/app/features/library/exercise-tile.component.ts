import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import type { Exercise } from '../../domain/models/schemas';
import { ExerciseFigureComponent } from '../../shared/ui/exercise-figure/exercise-figure.component';
import { CATEGORY_LABEL, DIFFICULTY_LABEL, MEASURE_LABEL } from '../../shared/labels';

@Component({
  selector: 'df-exercise-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatIconModule, ExerciseFigureComponent],
  template: `
    @let ex = exercise();
    <a class="tile" [routerLink]="['/library', ex.id]" [attr.aria-label]="ariaLabel()">
      <div class="figure" aria-hidden="true"><df-exercise-figure [figure]="ex.figure" /></div>
      <div class="name">{{ ex.name }}</div>
      <div class="meta" aria-hidden="true">
        <span class="dots">
          @for (d of [1, 2, 3, 4, 5]; track d) {
            <i [class.on]="d <= ex.difficulty"></i>
          }
        </span>
        <mat-icon class="measure">{{ ex.measure === 'seconds' ? 'timer' : 'repeat' }}</mat-icon>
      </div>
      <div class="category" aria-hidden="true">
        {{ category() }}@if (!ex.builtIn) { <span class="mine">Yours</span> }
      </div>
    </a>
  `,
  styles: `
    :host { display: block; }
    .tile {
      --suit: var(--mat-sys-primary);
      display: grid; gap: 4px; height: 100%; box-sizing: border-box;
      padding: 8px 10px 10px; border-radius: 12px; text-decoration: none; color: var(--mat-sys-on-surface);
      background: var(--mat-sys-surface-container-low); border: 1px solid var(--mat-sys-outline-variant);
      &:hover { background: var(--mat-sys-surface-container); }
      &:focus-visible { outline: 3px solid var(--mat-sys-primary); outline-offset: 2px; }
    }
    .figure { aspect-ratio: 1; }
    .mine { margin-left: 6px; padding: 0 6px; border-radius: 8px; background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); }
    .name { font: var(--mat-sys-title-small); min-height: 2.5em; }
    .meta { display: flex; align-items: center; justify-content: space-between; }
    .dots { display: flex; gap: 3px; }
    .dots i { width: 7px; height: 7px; border-radius: 50%; border: 1.5px solid var(--mat-sys-outline); }
    .dots i.on { background: var(--mat-sys-primary); border-color: var(--mat-sys-primary); }
    .measure { font-size: 18px; width: 18px; height: 18px; color: var(--mat-sys-on-surface-variant); }
    .category { font: var(--mat-sys-label-small); color: var(--mat-sys-on-surface-variant); }
  `,
})
export class ExerciseTileComponent {
  readonly exercise = input.required<Exercise>();
  protected readonly category = computed(() => CATEGORY_LABEL[this.exercise().category]);
  protected readonly ariaLabel = computed(() => {
    const e = this.exercise();
    return `${e.name}, ${CATEGORY_LABEL[e.category]}, ${DIFFICULTY_LABEL[e.difficulty]}, ${MEASURE_LABEL[e.measure]}`;
  });
}
