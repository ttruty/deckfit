import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';
import { PERIODS, type Period, type PeriodTotals } from '../../domain/history/period';
import { SUIT_NAME, SUIT_SYMBOL } from '../../shared/labels';
import { SegmentedComponent } from '../../shared/ui/segmented/segmented.component';

const TOP_EXERCISES = 6;

/**
 * Totals for one window (§9e): the four stat tiles, reps by suit group, and the exercises you
 * did most. The period control sets all three at once.
 */
@Component({
  selector: 'df-period-totals',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, SegmentedComponent],
  templateUrl: './period-totals.component.html',
  styleUrl: './period-totals.component.scss',
})
export class PeriodTotalsComponent {
  readonly totals = input.required<PeriodTotals>();
  readonly period = model.required<Period>();

  protected readonly periods = PERIODS.map((p) => ({ value: p.id, label: p.label }));
  protected readonly symbol = SUIT_SYMBOL;
  protected readonly suitName = SUIT_NAME;
  protected readonly showAll = signal(false);

  protected readonly windowLabel = computed(
    () => PERIODS.find((p) => p.id === this.period())?.label.toLowerCase() ?? 'period',
  );

  /** Bars are drawn against the busiest group, so the longest one always fills the track. */
  protected readonly bars = computed(() => {
    const groups = this.totals().groups;
    const max = Math.max(1, ...groups.map((g) => g.reps));
    return groups.map((group) => ({ ...group, percent: Math.round((group.reps / max) * 100) }));
  });

  protected readonly anyZero = computed(() => this.totals().groups.some((g) => g.reps === 0));

  protected readonly exercises = computed(() => {
    const all = this.totals().exercises;
    return this.showAll() ? all : all.slice(0, TOP_EXERCISES);
  });
  protected readonly hidden = computed(() => Math.max(0, this.totals().exercises.length - TOP_EXERCISES));

  /** "42m 30s", and "15h 43m" once it runs past an hour. */
  protected time(total: number): { value: number; unit: string; rest: number; restUnit: string } | null {
    if (!total) return null;
    if (total >= 3600) {
      return { value: Math.floor(total / 3600), unit: 'h', rest: Math.round((total % 3600) / 60), restUnit: 'm' };
    }
    return { value: Math.floor(total / 60), unit: 'm', rest: total % 60, restUnit: 's' };
  }

  protected amount(measure: string, amount: number): string {
    if (measure !== 'seconds') return `${amount.toLocaleString('en-US')} reps`;
    const m = Math.floor(amount / 60);
    const s = amount % 60;
    return m ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`;
  }
}
