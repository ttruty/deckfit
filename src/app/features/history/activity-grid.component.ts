import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import type { ActivityGrid } from './activity-grid';

/**
 * The activity grid (§9e): one square per day, shaded by the work that day held, with the
 * streaks said in words above it. Colour alone carries the shading, so every square also
 * names its day and its work to a screen reader, and the summary line is plain text.
 *
 * Every square is a button: picking one opens that day (`selected`), and picking it again
 * closes it.
 */
@Component({
  selector: 'df-activity-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let g = grid();
    <p class="summary">
      <strong>{{ g.currentStreak }}</strong> {{ g.currentStreak === 1 ? 'day' : 'days' }} in a row ·
      best {{ g.bestStreak }} · {{ g.activeDays }} {{ g.activeDays === 1 ? 'day' : 'days' }} worked
      in the last {{ g.weeks.length }} weeks
    </p>

    <div class="scroller">
      <div class="chart">
        <ol class="months" aria-hidden="true">
          @for (month of g.months; track $index) { <li>{{ month }}</li> }
        </ol>
        <ul class="days" aria-hidden="true">
          <li>Mon</li><li></li><li>Wed</li><li></li><li>Fri</li><li></li><li>Sun</li>
        </ul>
        <ol class="grid" [attr.aria-label]="'Workouts per day for the last ' + g.weeks.length + ' weeks'">
          @for (week of g.weeks; track week[0].date) {
            @for (day of week; track day.date) {
              <li>
                <button type="button" class="day" [class.future]="day.future" [class.on]="selected() === day.date"
                        [attr.data-level]="day.level" [attr.data-date]="day.date"
                        [attr.aria-pressed]="selected() === day.date"
                        [attr.aria-label]="label(day.at, day.workouts, day.points)"
                        [title]="label(day.at, day.workouts, day.points)"
                        (click)="pick(day.date)"></button>
              </li>
            }
          }
        </ol>
      </div>
    </div>

    <p class="legend" aria-hidden="true">
      <span>Less</span>
      @for (level of levels; track level) { <span class="day legend-swatch" [attr.data-level]="level"></span> }
      <span>More</span>
    </p>
  `,
  styles: `
    :host { display: grid; gap: 10px; }
    .summary { margin: 0; font: var(--mat-sys-body-medium); strong { font: var(--mat-sys-title-medium); } }

    /* Half a year of squares: the grid shrinks to fit, and only scrolls when it can't. The
       padding gives the selected square's ring room, which the overflow would otherwise clip. */
    .scroller { overflow-x: auto; overflow-y: hidden; padding: 4px; margin: -4px; }
    /* Squares stay square and stop growing on a wide screen; below ~300px the scroller kicks in. */
    .chart {
      display: grid; gap: 4px 6px; min-width: 260px; max-width: 560px;
      grid-template-columns: auto 1fr; grid-template-areas: '. months' 'days grid';
    }
    .months {
      grid-area: months; list-style: none; margin: 0; padding: 0;
      display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 2px;
      font: var(--mat-sys-label-small); color: var(--mat-sys-on-surface-variant);
      li { min-width: 0; white-space: nowrap; }
    }
    .days {
      grid-area: days; list-style: none; margin: 0; padding: 0;
      display: grid; grid-template-rows: repeat(7, 1fr); gap: 2px; align-items: center;
      font: var(--mat-sys-label-small); color: var(--mat-sys-on-surface-variant);
    }
    .grid {
      grid-area: grid; list-style: none; margin: 0; padding: 0;
      display: grid; grid-template-rows: repeat(7, 1fr); grid-auto-flow: column;
      grid-auto-columns: 1fr; gap: 2px;
      li { display: grid; }
    }
    .day {
      aspect-ratio: 1; min-width: 8px; border-radius: 3px; padding: 0; border: 0;
      background: var(--mat-sys-surface-container-highest);
      &:not(.legend-swatch) { cursor: pointer; }
      &:focus-visible { outline: 2px solid var(--mat-sys-primary); outline-offset: 2px; }
      &.on { box-shadow: 0 0 0 2px var(--mat-sys-surface), 0 0 0 4px var(--mat-sys-primary); }
      &[data-level='1'] { background: color-mix(in srgb, var(--mat-sys-primary) 30%, var(--mat-sys-surface-container-highest)); }
      &[data-level='2'] { background: color-mix(in srgb, var(--mat-sys-primary) 55%, var(--mat-sys-surface-container-highest)); }
      &[data-level='3'] { background: color-mix(in srgb, var(--mat-sys-primary) 80%, var(--mat-sys-surface-container-highest)); }
      &[data-level='4'] { background: var(--mat-sys-primary); }
      &.future { background: none; box-shadow: inset 0 0 0 1px var(--mat-sys-outline-variant); }
    }
    .legend {
      display: flex; align-items: center; gap: 4px; margin: 0; justify-content: flex-end;
      font: var(--mat-sys-label-small); color: var(--mat-sys-on-surface-variant);
      .day { width: 10px; aspect-ratio: 1; cursor: default; }
    }
  `,
})
export class ActivityGridComponent {
  readonly grid = input.required<ActivityGrid>();
  /** The open day, `YYYY-MM-DD`, or null. Two-way: the page shows it, the grid picks it. */
  readonly selected = model<string | null>(null);
  protected readonly levels = [0, 1, 2, 3, 4] as const;
  private readonly date = new DatePipe('en-US');
  private readonly number = new DecimalPipe('en-US');

  protected pick(date: string): void {
    this.selected.update((current) => (current === date ? null : date));
  }

  /** "Tue 17 Mar: 2 workouts, 140 points" — what the shading means, in words. */
  protected label(at: number, workouts: number, points: number): string {
    const day = this.date.transform(at, 'EEE d MMM') ?? '';
    if (!workouts) return `${day}: nothing logged`;
    const count = `${workouts} ${workouts === 1 ? 'workout' : 'workouts'}`;
    return `${day}: ${count}, ${this.number.transform(points)} points`;
  }
}
