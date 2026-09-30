import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { DECK_LENGTHS } from '../../../domain/models/deck-rules';
import { SegmentedComponent, type SegmentedOption } from '../segmented/segmented.component';

const ALL = 'all';

/**
 * How many cards to play with (§9g): one control for every place a workout's length is chosen —
 * Quick start, /room/new and the routine form. `null` means the whole deck; anything shorter is
 * trimmed by `trimToCount`, so every suit and every difficulty tier is still represented.
 */
@Component({
  selector: 'df-deck-length',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SegmentedComponent],
  template: `
    <df-segmented [legend]="label()" [options]="options()" [value]="picked()" (valueChange)="pick($event)" />
    <p class="df-hint">{{ hint() }}</p>
  `,
  styles: `:host { display: grid; gap: 6px; }`,
})
export class DeckLengthPickerComponent {
  /** Cards to deal with; null = the whole deck. */
  readonly value = model.required<number | null>();
  /** The deck's size, so the control never offers a length that isn't shorter than it. */
  readonly deckSize = input.required<number>();
  readonly label = input('Deck length');

  /** The offered lengths, plus whatever a saved routine already asks for. */
  protected readonly options = computed<SegmentedOption<string>[]>(() => {
    const size = this.deckSize();
    const value = this.value();
    const lengths = [...new Set([...DECK_LENGTHS, ...(value === null ? [] : [value])])]
      .filter((n) => n < size)
      .sort((a, b) => a - b);
    return [...lengths.map((n) => ({ value: String(n), label: String(n) })), { value: ALL, label: 'All' }];
  });

  protected readonly picked = computed(() => {
    const value = this.value();
    return value === null || value >= this.deckSize() ? ALL : String(value);
  });

  protected readonly hint = computed(() => {
    const size = this.deckSize();
    const value = this.value();
    if (value === null || value >= size) return `The whole deck — every one of its ${size} cards.`;
    return `${value} of ${size} cards, a share of every suit. A shorter deck is a shorter workout.`;
  });

  protected pick(value: string): void {
    this.value.set(value === ALL ? null : Number(value));
  }
}

/** `deckFilters.cardCount` for a chosen length: absent when it wouldn't shorten the deck. */
export function cardCountFilter(length: number | null, deckSize: number): { cardCount?: number } {
  return length !== null && length < deckSize ? { cardCount: length } : {};
}
