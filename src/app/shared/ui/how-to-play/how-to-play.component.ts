import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** A game's rules in plain language: the one-line summary, then the numbered steps (§6.3 `howTo`). */
@Component({
  selector: 'df-how-to-play',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (summary()) { <p class="summary">{{ summary() }}</p> }
    @if (steps().length) {
      <ol>
        @for (step of steps(); track $index) { <li>{{ step }}</li> }
      </ol>
    } @else {
      <p class="summary">No rules written for this game yet.</p>
    }
  `,
  styles: `
    :host { display: block; }
    .summary { margin: 0 0 8px; font: var(--mat-sys-body-medium); }
    ol { margin: 0; padding-left: 22px; display: grid; gap: 6px; font: var(--mat-sys-body-medium); }
    li::marker { font-weight: 700; color: var(--mat-sys-primary); }
  `,
})
export class HowToPlayComponent {
  readonly steps = input.required<readonly string[]>();
  readonly summary = input('');
}
