import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

const R = 44;
const CIRCUMFERENCE = 2 * Math.PI * R;

/** Countdown ring: `progress` 0→1 fills the ring; center shows `label`. */
@Component({
  selector: 'df-timer-ring',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle class="track" cx="50" cy="50" [attr.r]="r" />
      <circle class="fill" cx="50" cy="50" [attr.r]="r" [attr.stroke-dasharray]="circumference" [attr.stroke-dashoffset]="offset()" />
    </svg>
    <div class="label" role="timer" [attr.aria-label]="ariaLabel()">
      <span class="value">{{ label() }}</span>
      @if (unit()) { <span class="unit">{{ unit() }}</span> }
    </div>
  `,
  styles: `
    :host { position: relative; display: inline-grid; place-items: center; width: var(--ring-size, 160px); aspect-ratio: 1; }
    svg { position: absolute; inset: 0; transform: rotate(-90deg); }
    circle { fill: none; stroke-width: 7; }
    .track { stroke: var(--mat-sys-surface-container-highest); }
    .fill { stroke: var(--ring-color, var(--mat-sys-primary)); stroke-linecap: round; }
    @media (prefers-reduced-motion: no-preference) { .fill { transition: stroke-dashoffset 250ms linear; } }
    .label { display: grid; justify-items: center; line-height: 1; }
    .value { font-family: var(--font-display); font-weight: 800; font-size: calc(var(--ring-size, 160px) * 0.36); }
    .unit { font: var(--mat-sys-label-large); color: var(--mat-sys-on-surface-variant); }
  `,
})
export class TimerRingComponent {
  readonly progress = input(0);
  readonly label = input<string | number>('');
  readonly unit = input('');
  readonly ariaLabel = input('');

  protected readonly r = R;
  protected readonly circumference = CIRCUMFERENCE;
  protected readonly offset = computed(() => CIRCUMFERENCE * (1 - Math.min(1, Math.max(0, this.progress()))));
}
