import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { INTENSITIES, type Intensity } from '../../../domain/models/schemas';
import { INTENSITY_HELP, INTENSITY_LABEL } from '../../labels';

/**
 * Low / moderate / high (§6.1): one control for every place a workout's intensity is chosen —
 * Quick Start, the routine form, /room/new and the room lobby. Buttons rather than a select,
 * because it's a three-way choice people change often; 44px targets (§9).
 */
@Component({
  selector: 'df-intensity-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="label" [id]="labelId">{{ label() }}</p>
    <div class="levels" role="group" [attr.aria-labelledby]="labelId">
      @for (level of levels; track level) {
        <button type="button" class="level" [class.on]="value() === level" [disabled]="disabled()"
                [attr.aria-pressed]="value() === level" (click)="value.set(level)">
          {{ labels[level] }}
        </button>
      }
    </div>
    <p class="hint">{{ help[value()] }}</p>
  `,
  styles: `
    :host { display: grid; gap: 6px; }
    .label { margin: 0; font: var(--mat-sys-title-small); }
    .levels { display: flex; gap: 6px; }
    .level {
      flex: 1 1 0; min-width: 0; min-height: 44px; padding: 6px 10px; border-radius: 999px; cursor: pointer;
      font: var(--mat-sys-label-large); color: inherit; background: transparent;
      border: 1px solid var(--mat-sys-outline-variant);
      &.on { background: var(--mat-sys-primary); color: var(--mat-sys-on-primary); border-color: transparent; }
      &:disabled { opacity: 0.5; cursor: default; }
      &:focus-visible { outline: 3px solid var(--mat-sys-primary); outline-offset: 2px; }
    }
    .hint { margin: 0; font: var(--mat-sys-body-small); color: var(--mat-sys-on-surface-variant); }
  `,
})
export class IntensityPickerComponent {
  readonly value = model.required<Intensity>();
  readonly label = input('Intensity');
  readonly disabled = input(false);

  protected readonly levels = INTENSITIES;
  protected readonly labels = INTENSITY_LABEL;
  protected readonly help = INTENSITY_HELP;
  protected readonly labelId = `intensity-${Math.random().toString(36).slice(2, 8)}`;
}
