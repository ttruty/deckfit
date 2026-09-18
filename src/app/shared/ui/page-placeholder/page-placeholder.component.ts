import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Stand-in body for screens that are routed but not built yet. */
@Component({
  selector: 'df-page-placeholder',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="placeholder">
      <h1>{{ heading() }}</h1>
      <p>{{ summary() }}</p>
      @if (detail()) {
        <p class="detail">{{ detail() }}</p>
      }
      <p class="phase">Coming in phase {{ phase() }}.</p>
      <ng-content />
    </section>
  `,
  styles: `
    .placeholder { max-width: 65ch; margin: 0 auto; padding: 24px 16px; }
    h1 { font: var(--mat-sys-headline-medium); margin: 0 0 12px; }
    p { font: var(--mat-sys-body-large); margin: 0 0 8px; }
    .detail { font-family: monospace; }
    .phase { color: var(--mat-sys-on-surface-variant); }
  `,
})
export class PagePlaceholderComponent {
  readonly heading = input.required<string>();
  readonly summary = input.required<string>();
  readonly detail = input<string>('');
  readonly phase = input.required<number>();
}
