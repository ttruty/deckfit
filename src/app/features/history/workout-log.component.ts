import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { dayKey } from '../../domain/challenges/progress';
import type { SessionRow } from '../../domain/history/history-stats';
import { INTENSITY_LABEL } from '../../shared/labels';
import { DfIconComponent } from '../../shared/ui/icon/df-icon.component';

const PAGE = 8;

/** Every workout, newest first (§9e). Tapping one opens that day above. */
@Component({
  selector: 'df-workout-log',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DfIconComponent],
  template: `
    <ul class="df-list">
      @for (row of shown(); track row.session.id) {
        <li>
          <button type="button" class="df-row df-log" (click)="opened.emit(day(row))">
            <span class="df-date">
              <b>{{ row.session.startedAt | date: 'd' }}</b>
              <span>{{ row.session.startedAt | date: 'MMM' }}</span>
            </span>
            <span class="df-item__text">
              <span class="df-item__name">{{ row.session.game.name }}</span>
              <span class="df-item__meta">{{ meta(row) }}</span>
            </span>
            <df-icon name="chevron" />
          </button>
        </li>
      }
    </ul>

    @if (more()) {
      <button type="button" class="df-btn df-btn--outline df-more" (click)="page.set(page() + 1)">
        Show older workouts
      </button>
    }
  `,
  styles: `
    :host { display: contents; }
    .df-log {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 72px;
      padding: 8px;
      border: 0;
      text-align: left;
      color: var(--df-text);
      font: inherit;
      cursor: pointer;

      &:hover { background: var(--df-row-hover); }
      &:focus-visible { outline: 3px solid var(--df-primary); outline-offset: 2px; }
      df-icon { color: var(--df-text-muted); }
    }
    .df-date {
      width: 52px;
      flex: none;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 4px 0;
      border-radius: 12px;
      background: var(--df-card-bg);
      border: 1px solid var(--df-edge);

      b { font-family: var(--font-display); font-weight: 800; font-size: 1.5rem; line-height: 1; }
      span { font-size: 0.75rem; font-weight: 500; color: var(--df-text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
    }
    .df-more { align-self: center; }
  `,
})
export class WorkoutLogComponent {
  readonly rows = input.required<readonly SessionRow[]>();
  /** Today, so "Today"/"Yesterday" mean what they say. */
  readonly today = input.required<number>();
  readonly opened = output<string>();

  protected readonly page = signal(1);
  protected readonly shown = computed(() => this.rows().slice(0, this.page() * PAGE));
  protected readonly more = computed(() => this.rows().length > this.shown().length);

  private readonly date = new DatePipe('en-US');
  private readonly number = new DecimalPipe('en-US');

  protected day(row: SessionRow): string {
    return dayKey(row.session.startedAt);
  }

  /** "Today · Bodyweight deck · 15 reps · 4 min · Low", plus who else was in a room game. */
  protected meta(row: SessionRow): string {
    const parts = [this.when(row.session.startedAt), row.session.deck.name];
    if (row.reps) parts.push(`${this.number.transform(row.reps)} reps`);
    if (row.seconds) parts.push(`${formatSeconds(row.seconds)} timed`);
    if (row.inProgress) parts.push('still open');
    else if (row.minutes) parts.push(`${row.minutes} min`);
    const intensity = row.session.settings.intensity;
    if (intensity) parts.push(INTENSITY_LABEL[intensity]);
    const others = row.session.players.length - 1;
    if (others > 0) parts.push(`with ${others} ${others === 1 ? 'other' : 'others'}`);
    return parts.join(' · ');
  }

  /** Today, Yesterday, then the weekday for the rest of the week, then the date. */
  private when(at: number): string {
    const start = new Date(this.today());
    start.setHours(0, 0, 0, 0);
    const days = Math.round((start.getTime() - startOfDay(at)) / 86_400_000);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return this.date.transform(at, 'EEEE') ?? '';
    return this.date.transform(at, 'd MMM') ?? '';
  }
}

function startOfDay(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`;
}
