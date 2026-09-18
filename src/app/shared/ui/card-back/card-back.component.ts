import { ChangeDetectionStrategy, Component } from '@angular/core';

/** A face-down card (5:7, same size rules as CardFaceComponent: scales with font-size). */
@Component({
  selector: 'df-card-back',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="mark" aria-hidden="true">DF</span>`,
  host: { role: 'img', 'aria-label': 'Face-down card' },
  styles: `
    :host {
      display: grid; place-items: center; aspect-ratio: 5 / 7; width: 100%; box-sizing: border-box;
      border-radius: var(--card-radius, 10px); border: 0.5em solid var(--paper, #eef2ef);
      background: repeating-linear-gradient(45deg, var(--ink, #1f2a44) 0 0.8em, color-mix(in srgb, var(--ink, #1f2a44) 80%, var(--paper, #eef2ef)) 0.8em 1.6em);
      box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
    }
    .mark { font-family: var(--font-display); font-weight: 800; font-size: 3em; color: var(--paper, #eef2ef); }
  `,
})
export class CardBackComponent {}
