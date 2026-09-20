import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

const PARTICLES_PER_BURST = 12;
/** Where each burst goes off, as a percentage of the box, with the delay that staggers them. */
const BURSTS = [
  { x: 22, y: 34, delay: 0, hue: 'var(--suit-hearts)' },
  { x: 74, y: 26, delay: 0.35, hue: 'var(--suit-diamonds)' },
  { x: 48, y: 58, delay: 0.7, hue: 'var(--suit-clubs)' },
  { x: 16, y: 66, delay: 1.05, hue: 'var(--suit-spades)' },
  { x: 84, y: 62, delay: 1.4, hue: 'var(--suit-joker)' },
];

/**
 * Celebration for a win: a few CSS bursts in the suit colours, three cycles then gone. Purely
 * decorative (aria-hidden) and it does nothing at all under `prefers-reduced-motion` (§9).
 */
@Component({
  selector: 'df-fireworks',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  template: `
    @for (burst of bursts(); track $index) {
      <span class="burst" [style.--x.%]="burst.x" [style.--y.%]="burst.y" [style.--delay.s]="burst.delay" [style.--hue]="burst.hue">
        @for (angle of angles; track $index) {
          <span class="spark" [style.--a.deg]="angle"></span>
        }
      </span>
    }
  `,
  styles: `
    :host {
      position: absolute;
      inset: 0;
      overflow: hidden;
      pointer-events: none;
      border-radius: inherit;
    }
    .burst {
      position: absolute;
      left: var(--x);
      top: var(--y);
      width: 0;
      height: 0;
    }
    .spark {
      position: absolute;
      width: 0.6rem;
      height: 0.6rem;
      margin: -0.3rem;
      border-radius: 50%;
      background: var(--hue);
      box-shadow: 0 0 0.5rem color-mix(in srgb, var(--hue) 70%, transparent);
      opacity: 0;
      animation: spark 1.8s cubic-bezier(0.12, 0.72, 0.3, 1) var(--delay) 3 both;
      transform: rotate(var(--a)) translateY(0);
    }
    /* Alternate sparks fly shorter, so a burst reads as a burst rather than a ring. */
    .spark:nth-child(even) { --reach: 4.5rem; width: 0.42rem; height: 0.42rem; margin: -0.21rem; }
    .spark:nth-child(odd) { --reach: 7rem; }

    @keyframes spark {
      0% { opacity: 0; transform: rotate(var(--a)) translateY(0) scale(0.5); }
      8% { opacity: 1; transform: rotate(var(--a)) translateY(calc(var(--reach, 5rem) * -0.15)) scale(1.15); }
      75% { opacity: 0.95; }
      100% { opacity: 0; transform: rotate(var(--a)) translateY(calc(var(--reach, 5rem) * -1)) scale(0.3); }
    }

    @media (prefers-reduced-motion: reduce) {
      :host { display: none; }
    }
  `,
})
export class FireworksComponent {
  /** How many bursts to set off (1–5). */
  readonly count = input(3);
  protected readonly bursts = computed(() => BURSTS.slice(0, Math.max(1, Math.min(this.count(), BURSTS.length))));
  protected readonly angles = Array.from({ length: PARTICLES_PER_BURST }, (_, i) => (360 / PARTICLES_PER_BURST) * i);
}
