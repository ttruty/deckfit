import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import type { ActivityGrid } from '../../domain/history/activity-grid';

/**
 * The 26-week calendar (§9e): a square per day, Monday at the top of each column, shaded by the
 * reps that day held. Colour is the only thing carrying the shading, so the whole grid is one
 * `role="img"` with a sentence, every square names its day and work, and the legend spells out
 * the bands. Squares are buttons: picking one opens that day below.
 */
@Component({
  selector: 'df-heatmap',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let g = grid();
    <div class="df-streak-nums">
      <p class="df-bignum" [attr.aria-label]="g.currentStreak + ' ' + (g.currentStreak === 1 ? 'day' : 'days') + ' in a row'">
        <b>{{ g.currentStreak }}</b><span>{{ g.currentStreak === 1 ? 'day' : 'days' }} in a row</span>
      </p>
      <p class="df-kv"><span>Best</span><strong>{{ g.bestStreak }} {{ g.bestStreak === 1 ? 'day' : 'days' }}</strong></p>
      <p class="df-kv"><span>Days worked</span><strong>{{ g.activeDays }} of {{ g.days }}</strong></p>
    </div>

    <div class="df-heat" role="img" [attr.aria-label]="summary()">
      @for (month of g.months; track $index) {
        @if (month) {
          <span class="df-heat__month" [style.grid-column]="$index + 2">{{ month }}</span>
        }
      }
      <span class="df-heat__day" style="grid-row: 2">Mon</span>
      <span class="df-heat__day" style="grid-row: 4">Wed</span>
      <span class="df-heat__day" style="grid-row: 6">Fri</span>
      <span class="df-heat__day" style="grid-row: 8">Sun</span>

      @for (week of g.weeks; track week[0].date; let w = $index) {
        @for (day of week; track day.date; let d = $index) {
          @if (day.future) {
            <span class="df-cell df-cell--future" [style.grid-column]="w + 2" [style.grid-row]="d + 2"></span>
          } @else {
            <button type="button" class="df-cell" [class.df-cell--today]="day.today" [class.on]="selected() === day.date"
                    [attr.data-l]="day.level" [attr.data-date]="day.date"
                    [style.grid-column]="w + 2" [style.grid-row]="d + 2"
                    [attr.aria-pressed]="selected() === day.date" [attr.aria-label]="label(day)" [title]="label(day)"
                    (click)="pick(day.date)"></button>
          }
        }
      }
    </div>

    <div class="df-heat-legend">
      <span class="df-today-key"><span class="df-cell df-cell--today"></span>Today</span>
      <ol aria-label="Reps per day">
        <li><span class="df-cell" data-l="0"></span>0</li>
        <li><span class="df-cell" data-l="1"></span>1–30</li>
        <li><span class="df-cell" data-l="2"></span>31–60</li>
        <li><span class="df-cell" data-l="3"></span>61–90</li>
        <li><span class="df-cell" data-l="4"></span>91+ reps</li>
      </ol>
    </div>
  `,
  styleUrl: './heatmap.component.scss',
})
export class HeatmapComponent {
  readonly grid = input.required<ActivityGrid>();
  /** The open day, `YYYY-MM-DD`, or null. Two-way: the page shows it, the grid picks it. */
  readonly selected = model<string | null>(null);

  private readonly date = new DatePipe('en-US');
  private readonly number = new DecimalPipe('en-US');

  protected readonly summary = computed(() => {
    const g = this.grid();
    return `Streak: ${g.currentStreak} ${g.currentStreak === 1 ? 'day' : 'days'} in a row, best ${g.bestStreak}, ${g.activeDays} of the last ${g.days} days worked. Darker squares mean more reps.`;
  });

  protected pick(date: string): void {
    this.selected.update((current) => (current === date ? null : date));
  }

  /** "Thu 9 Apr: 88 reps" · "Mon 6 Apr: rest day" · seconds named where there are any. */
  protected label(day: ActivityGrid['weeks'][number][number]): string {
    const when = this.date.transform(day.at, 'EEE d MMM') ?? '';
    if (!day.workouts) return `${when}: rest day`;
    const parts: string[] = [];
    if (day.reps) parts.push(`${this.number.transform(day.reps)} reps`);
    if (day.seconds) parts.push(`${formatSeconds(day.seconds)} timed`);
    return `${when}: ${parts.join(' · ')}`;
  }
}

function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`;
}
