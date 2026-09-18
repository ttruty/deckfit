import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import type { Exercise } from '../../domain/models/schemas';

/**
 * Wild joker (§6.1 `jokerRule: 'wild'`): the player names the exercise they did, so the work is
 * logged under it instead of "wild". "Your own choice" leaves it unlogged by exercise.
 */
@Component({
  selector: 'df-wild-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label>
      <span>Wild card — pick any exercise</span>
      <select [value]="exerciseId() ?? ''" (change)="exerciseId.set($any($event.target).value || null)">
        <option value="">Your own choice</option>
        @for (ex of options(); track ex.id) { <option [value]="ex.id">{{ ex.name }}</option> }
      </select>
    </label>
  `,
  styles: `
    label { display: grid; gap: 4px; justify-items: center; font: var(--mat-sys-body-medium); }
    select {
      font: var(--mat-sys-body-large); padding: 8px 10px; min-height: 44px; border-radius: 10px;
      border: 1px solid var(--mat-sys-outline); background: var(--mat-sys-surface); color: var(--mat-sys-on-surface);
    }
    select:focus-visible { outline: 3px solid var(--mat-sys-primary); outline-offset: 2px; }
  `,
})
export class WildPickerComponent {
  readonly options = input.required<readonly Exercise[]>();
  readonly exerciseId = model<string | null>(null);
}
