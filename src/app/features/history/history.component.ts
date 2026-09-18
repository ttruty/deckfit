import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, resource } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { ExerciseRepository, SessionRepository } from '../../core/db/repositories';
import { SUIT_NAME, SUIT_SYMBOL } from '../../shared/labels';
import { historyStats } from './history-stats';

@Component({
  selector: 'df-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, RouterLink, MatButtonModule, MatIconModule],
  templateUrl: './history.component.html',
  styleUrl: './history.component.scss',
})
export class HistoryComponent {
  private readonly sessions = inject(SessionRepository);
  private readonly exercises = inject(ExerciseRepository);

  protected readonly data = resource({
    loader: async () => {
      const [sessions, exercises] = await Promise.all([this.sessions.list(), this.exercises.list()]);
      return historyStats(sessions, new Map(exercises.map((e) => [e.id, e])));
    },
  });

  protected readonly stats = computed(() => this.data.value());

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
