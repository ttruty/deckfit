import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { DfIconComponent } from '../icon/df-icon.component';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/**
 * The pill segmented control from the mockups: intensity on Home, the period on History.
 *
 * Native radios in a fieldset, so it works with a keyboard and a screen reader for free, and the
 * selected option carries a check mark as well as the fill — colour never says it alone (§9).
 */
@Component({
  selector: 'df-segmented',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DfIconComponent],
  template: `
    <fieldset class="df-seg-field">
      <legend [class.df-vh]="hideLegend()">{{ legend() }}</legend>
      <div class="df-seg">
        @for (option of options(); track option.value) {
          <label class="df-seg__opt">
            <input
              type="radio"
              [name]="group"
              [value]="option.value"
              [checked]="value() === option.value"
              (change)="value.set(option.value)"
            />
            <df-icon name="check" />
            <span>{{ option.label }}</span>
          </label>
        }
      </div>
    </fieldset>
  `,
  styles: `
    :host { display: block; }
    .df-seg-field { border: 0; margin: 0; padding: 0; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
    legend { padding: 0; margin-bottom: 8px; font-size: 0.8125rem; font-weight: 500; color: var(--df-text-muted); }
    .df-seg {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: minmax(0, 1fr);
      border: 1px solid var(--df-text-muted);
      border-radius: 999px;
      overflow: hidden;
    }
    .df-seg__opt {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-height: 48px;
      padding: 0 8px;
      font-weight: 500;
      cursor: pointer;
      color: var(--df-text);
      white-space: nowrap;

      + .df-seg__opt { border-left: 1px solid var(--df-text-muted); }
      input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; }
      df-icon { display: none; }
      &:has(input:checked) { background: var(--df-primary); color: var(--df-on-primary); }
      &:has(input:checked) df-icon { display: contents; }
      &:has(input:focus-visible) { outline: 3px solid var(--df-primary); outline-offset: 2px; z-index: 1; }
    }
    .df-seg__opt .df-ico { width: 18px; height: 18px; }
  `,
})
export class SegmentedComponent<T extends string> {
  readonly options = input.required<readonly SegmentedOption<T>[]>();
  readonly value = model.required<T>();
  readonly legend = input('');
  /** Keeps the legend for screen readers when the heading above already says what this is. */
  readonly hideLegend = input(false);

  /** Radios need a name per instance, or two controls on one page share a selection. */
  protected readonly group = `df-seg-${Math.random().toString(36).slice(2, 8)}`;
  protected readonly checked = computed(() => this.value());
}
