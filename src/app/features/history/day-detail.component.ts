import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import type { DayDetail } from './day-detail';

/** One day of history, opened from the activity grid (§9e): what was in it, and what it came to. */
@Component({
  selector: 'df-day-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, MatButtonModule, MatIconModule],
  template: `
    @let d = day();
    <div class="head">
      <h3>{{ d.at | date: 'EEEE d MMMM' }}</h3>
      <button mat-button type="button" (click)="closed.emit()"><mat-icon>close</mat-icon>Close</button>
    </div>

    @if (!d.workouts.length) {
      <p class="hint">Nothing logged that day.</p>
    } @else {
      <p class="totals">
        <strong>{{ d.workouts.length }}</strong> {{ d.workouts.length === 1 ? 'workout' : 'workouts' }}
        @if (d.reps) { · <strong>{{ d.reps | number }}</strong> reps }
        @if (d.seconds) { · <strong>{{ time(d.seconds) }}</strong> held }
      </p>

      <ul class="workouts">
        @for (w of d.workouts; track w.id) {
          <li>
            <span class="when">{{ w.at | date: 'shortTime' }}</span>
            <span class="what">
              <span class="name">
                {{ w.game }}
                @if (w.others) { <span class="with">with {{ w.others }} {{ w.others === 1 ? 'other' : 'others' }}</span> }
              </span>
              <span class="sub">
                {{ w.deck }}
                @if (w.reps) { · {{ w.reps | number }} reps }
                @if (w.seconds) { · {{ time(w.seconds) }} }
                @if (w.minutes) { · {{ w.minutes }} min }
                @if (w.inProgress) { · still open }
              </span>
            </span>
          </li>
        }
      </ul>

      @if (d.exercises.length) {
        <ul class="exercises">
          @for (e of d.exercises; track e.key) {
            <li>
              <span>{{ e.name }}</span>
              <span class="amount">{{ e.measure === 'seconds' ? time(e.amount) : (e.amount | number) + ' reps' }}</span>
            </li>
          }
        </ul>
      }
    }
  `,
  styles: `
    :host {
      display: grid; gap: 10px; padding: 12px 14px; border-radius: 16px;
      background: var(--df-row-bg); border: 1px solid var(--df-edge);
    }
    .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    h3 { margin: 0; font-family: var(--font-display); font-weight: 700; font-size: 1.2rem; }
    .hint { margin: 0; font: var(--mat-sys-body-medium); color: var(--mat-sys-on-surface-variant); }
    .totals { margin: 0; font: var(--mat-sys-body-medium); strong { font: var(--mat-sys-title-medium); } }

    .workouts {
      list-style: none; margin: 0; padding: 0; display: grid; gap: 8px;
      li { display: grid; grid-template-columns: 4.5rem 1fr; gap: 10px; align-items: baseline; }
      .when { font: var(--mat-sys-label-large); color: var(--mat-sys-on-surface-variant); font-variant-numeric: tabular-nums; }
      .what { display: grid; min-width: 0; }
      .name { font: var(--mat-sys-title-small); }
      .with { font: var(--mat-sys-label-small); color: var(--mat-sys-on-surface-variant); }
      .sub { font: var(--mat-sys-body-small); color: var(--mat-sys-on-surface-variant); }
    }
    .exercises {
      list-style: none; margin: 0; padding: 8px 0 0; display: grid; gap: 4px;
      border-top: 1px solid var(--df-edge);
      li { display: flex; justify-content: space-between; gap: 12px; font: var(--mat-sys-body-small); }
      .amount { color: var(--mat-sys-on-surface-variant); font-variant-numeric: tabular-nums; }
    }
  `,
})
export class DayDetailComponent {
  readonly day = input.required<DayDetail>();
  readonly closed = output<void>();

  /** "2m 05s", the same shape History uses elsewhere. */
  protected time(total: number): string {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`;
  }
}
