import { ChangeDetectionStrategy, Component, computed, inject, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HistoryService } from '../../core/history/history.service';
import { Clock } from '../../core/time/clock.service';
import { dayDetail } from '../../domain/history/day-detail';
import { periodTotals, type Period } from '../../domain/history/period';
import { DfIconComponent } from '../../shared/ui/icon/df-icon.component';
import { DayDetailComponent } from './day-detail.component';
import { HeatmapComponent } from './heatmap.component';
import { PeriodTotalsComponent } from './period-totals.component';
import { WorkoutLogComponent } from './workout-log.component';

/** History (§9e): the streak calendar, totals for a window, and every workout. */
@Component({
  selector: 'df-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DfIconComponent, DayDetailComponent, HeatmapComponent, PeriodTotalsComponent, WorkoutLogComponent],
  templateUrl: './history.component.html',
  styleUrl: './history.component.scss',
})
export class HistoryComponent {
  private readonly history = inject(HistoryService);
  private readonly clock = inject(Clock);

  /** Read once so "Today" and the calendar agree for the life of the screen. */
  protected readonly now = this.clock.epoch();

  protected readonly data = resource({ loader: () => this.history.load() });
  protected readonly stats = computed(() => this.data.value()?.stats);
  protected readonly grid = computed(() => this.data.value()?.grid);

  /** Which window the Totals section covers. */
  protected readonly period = signal<Period>('26w');
  protected readonly totals = computed(() => {
    const rows = this.stats()?.sessions;
    return rows ? periodTotals(rows, this.now, this.period()) : null;
  });

  /** The day opened from the calendar or a workout row (§9e). */
  protected readonly selectedDay = signal<string | null>(null);
  protected readonly day = computed(() => {
    const data = this.data.value();
    const day = this.selectedDay();
    return data && day ? dayDetail(data.stats.sessions, data.exercises, day) : null;
  });
}
