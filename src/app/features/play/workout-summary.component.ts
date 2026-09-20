import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import type { WorkoutSummary } from './play.store';
import { FireworksComponent } from '../../shared/ui/fireworks/fireworks.component';

/** End-of-workout panel: totals and time. Presentational. */
@Component({
  selector: 'df-workout-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, RouterLink, FireworksComponent],
  templateUrl: './workout-summary.component.html',
  styleUrl: './workout-summary.component.scss',
})
export class WorkoutSummaryComponent {
  readonly summary = input.required<WorkoutSummary>();
}
