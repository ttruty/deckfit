import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface JudgedTask {
  id: string;
  who: string;
  name: string;
  amount: number;
  measure: 'reps' | 'seconds';
}

/** The rotating judge's panel (§6.3 rep-race): count for the others and mark each one done. */
@Component({
  selector: 'df-judge-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule],
  template: `
    <h2 id="judge-title">You're judging this round</h2>
    <p class="hint">Count for the others and mark each one done as they finish. You sit this round out.</p>
    <ul>
      @for (t of tasks(); track t.id) {
        <li>
          <span class="who">{{ t.who }}</span>
          <span class="what">{{ t.amount }} {{ t.measure === 'seconds' ? 'sec' : 'reps' }} {{ t.name }}</span>
          <button mat-stroked-button (click)="skip.emit(t.id)" [attr.aria-label]="'Skip ' + t.who + '’s ' + t.name">Skip</button>
          <button mat-flat-button (click)="done.emit(t.id)" [attr.aria-label]="'Mark ' + t.who + '’s ' + t.name + ' done'">
            <mat-icon>check</mat-icon>Done
          </button>
        </li>
      } @empty {
        <li class="hint">Nobody is working right now.</li>
      }
    </ul>
    @if (canDeal()) {
      <button mat-flat-button class="deal" (click)="deal.emit()"><mat-icon>style</mat-icon>Deal the next round</button>
    }
  `,
  styles: `
    :host { display: grid; gap: 10px; justify-items: center; }
    h2 { margin: 0; font-family: var(--font-display); font-weight: 800; font-size: 1.8rem; }
    .hint { margin: 0; font: var(--mat-sys-body-medium); color: var(--mat-sys-on-surface-variant); }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; width: min(100%, 520px); }
    li { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px 12px; border-radius: 14px; background: var(--mat-sys-surface-container-high); }
    .who { font: var(--mat-sys-title-small); }
    .what { flex: 1; font: var(--mat-sys-body-medium); color: var(--mat-sys-on-surface-variant); }
    .deal { min-height: 56px; min-width: 120px; }
  `,
})
export class JudgePanelComponent {
  readonly tasks = input.required<readonly JudgedTask[]>();
  readonly canDeal = input(false);
  readonly done = output<string>();
  readonly skip = output<string>();
  readonly deal = output<void>();
}
