import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, resource, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { ExerciseRepository, SessionRepository } from '../../core/db/repositories';
import { SUIT_NAME, SUIT_SYMBOL } from '../../shared/labels';
import { historyStats } from './history-stats';
import { activityGrid } from './activity-grid';
import { ActivityGridComponent } from './activity-grid.component';
import { dayDetail } from './day-detail';
import { DayDetailComponent } from './day-detail.component';
import { Clock } from '../../core/time/clock.service';

@Component({
  selector: 'df-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, RouterLink, MatButtonModule, MatIconModule, ActivityGridComponent, DayDetailComponent],
  templateUrl: './history.component.html',
  styleUrl: './history.component.scss',
})
export class HistoryComponent {
  private readonly sessions = inject(SessionRepository);
  private readonly exercises = inject(ExerciseRepository);
  private readonly clock = inject(Clock);

  /** Day squares and streaks for the last half year (§9e). */
  protected readonly grid = computed(() => {
    const rows = this.stats()?.sessions;
    return rows ? activityGrid(rows, this.clock.epoch()) : null;
  });

  protected readonly data = resource({
    loader: async () => {
      const [sessions, exercises] = await Promise.all([this.sessions.list(), this.exercises.list()]);
      const byId = new Map(exercises.map((e) => [e.id, e]));
      return { stats: historyStats(sessions, byId), exercises: byId };
    },
  });

  protected readonly stats = computed(() => this.data.value()?.stats);

  /** The day opened from the grid, if any (§9e). */
  protected readonly selectedDay = signal<string | null>(null);
  protected readonly day = computed(() => {
    const data = this.data.value();
    const day = this.selectedDay();
    return data && day ? dayDetail(data.stats.sessions, data.exercises, day) : null;
  });

  /** Two separate bar lists (reps, seconds) — different units never share an axis. */
  protected readonly groupBars = computed(() => {
    const groups = this.stats()?.byGroup ?? [];
    const bars = (measure: 'reps' | 'seconds') => {
      const rows = groups.filter((g) => g[measure] > 0).sort((a, b) => b[measure] - a[measure]);
      const max = Math.max(1, ...rows.map((g) => g[measure]));
      return rows.map((g) => ({ ...g, value: g[measure], pct: (g[measure] / max) * 100, symbol: SUIT_SYMBOL[g.suit], suitName: SUIT_NAME[g.suit] }));
    };
    return { reps: bars('reps'), seconds: bars('seconds') };
  });

  protected formatSeconds(total: number): string {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`;
  }
}
