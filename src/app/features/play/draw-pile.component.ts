import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Face-down draw pile with a remaining-card badge. Presentational. */
@Component({
  selector: 'df-draw-pile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'img', '[attr.aria-label]': 'count() + " cards left to draw"' },
  template: `
    <div class="back" [class.empty]="count() === 0"></div>
    <span class="count" aria-hidden="true">{{ count() }}</span>
  `,
  styles: `
    :host { position: relative; display: block; flex: none; width: clamp(56px, 12vw, 96px); aspect-ratio: 5 / 7; }
    .back {
      position: absolute; inset: 0; border-radius: 10px; border: 2px solid var(--ink);
      background: repeating-linear-gradient(45deg, var(--suit-spades) 0 6px, color-mix(in srgb, var(--suit-spades) 70%, white) 6px 12px);
      box-shadow: 3px 3px 0 var(--ink-far);
      &.empty { background: transparent; border-style: dashed; box-shadow: none; opacity: 0.5; }
    }
    .count {
      position: absolute; right: -8px; bottom: -8px; min-width: 28px; padding: 2px 6px; border-radius: 14px; text-align: center;
      font: var(--mat-sys-label-large); background: var(--ink); color: var(--paper);
    }
  `,
})
export class DrawPileComponent {
  readonly count = input(0);
}
