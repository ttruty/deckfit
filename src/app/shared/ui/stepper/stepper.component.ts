import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/** Big-target numeric stepper (− value +), 56px buttons for arm's-length use (§9). */
@Component({
  selector: 'df-stepper',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <button type="button" class="step" (click)="set(value() - step())" [disabled]="value() <= min()" [attr.aria-label]="'Fewer ' + unit()">
      <mat-icon>remove</mat-icon>
    </button>
    <output class="value" [attr.aria-label]="value() + ' ' + unit()" aria-live="polite">
      <span class="num">{{ value() }}</span>
      <span class="unit">{{ unit() }}</span>
    </output>
    <button type="button" class="step" (click)="set(value() + step())" [disabled]="value() >= max()" [attr.aria-label]="'More ' + unit()">
      <mat-icon>add</mat-icon>
    </button>
  `,
  styles: `
    :host { display: inline-flex; align-items: center; gap: 12px; }
    .step {
      display: grid; place-items: center; width: 56px; height: 56px; border-radius: 50%; cursor: pointer;
      border: 2px solid var(--mat-sys-outline); background: var(--mat-sys-surface); color: var(--mat-sys-on-surface);
      &:disabled { opacity: 0.4; cursor: default; }
      &:focus-visible { outline: 3px solid var(--mat-sys-primary); outline-offset: 2px; }
    }
    .value { display: grid; justify-items: center; min-width: 3ch; line-height: 1; }
    .num { font-family: var(--font-display); font-weight: 800; font-size: 3.5rem; }
    .unit { font: var(--mat-sys-label-large); color: var(--mat-sys-on-surface-variant); }
  `,
})
export class StepperComponent {
  readonly value = model(0);
  readonly min = input(0);
  readonly max = input(999);
  readonly step = input(1);
  readonly unit = input('');

  protected set(v: number): void {
    this.value.set(Math.min(this.max(), Math.max(this.min(), v)));
  }
}
