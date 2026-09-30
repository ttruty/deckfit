import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { SUIT_NAME, SUIT_SYMBOL } from '../../labels';
import type { CardFaceModel } from './card-face.component';

/**
 * A small card, the way the mockups draw it beside Quick start and each deck: rank and pip on
 * paper, the exercise on a suit-coloured band. No pictogram — at this size the figure is noise,
 * and `df-card-face` already handles the full card.
 */
@Component({
  selector: 'df-card-face-mini',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let c = card();
    <span class="df-cardface" role="img" [attr.aria-label]="label()">
      <span class="df-cardface__rank">
        {{ c.rank === 'JOKER' ? '★' : c.rank }}
        @if (c.rank !== 'JOKER') { <span class="df-cardface__suit">{{ symbol[c.suit] }}</span> }
      </span>
      <span class="df-cardface__band">
        <span class="df-cardface__name">{{ c.exercise?.name ?? 'Joker' }}</span>
        <span class="df-cardface__amt">
          <span><b>{{ c.amount }}</b>{{ c.exercise?.measure === 'seconds' ? 'sec' : 'reps' }}</span>
          <span>{{ c.suitLabel }}</span>
        </span>
      </span>
    </span>
  `,
  styles: `
    :host { display: contents; }
    .df-cardface {
      --w: 104px;
      width: var(--w);
      aspect-ratio: 5 / 7;
      flex: none;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border-radius: var(--card-radius);
      background: var(--paper);
      color: var(--ink);
      border: 1px solid var(--df-edge);
      box-shadow: var(--df-shadow);
      font-family: var(--font-text);
    }
    :host(.tilted) .df-cardface { transform: rotate(3deg); }
    .df-cardface__rank {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 2px;
      font-family: var(--font-display);
      font-weight: 800;
      font-size: calc(var(--w) * 0.44);
      line-height: 1;
    }
    .df-cardface__suit { font-family: var(--font-text); font-size: 0.5em; color: var(--suit-text); }
    .df-cardface__band {
      background: var(--suit);
      color: var(--on-suit);
      padding: 6px 8px 5px;
      display: flex;
      flex-direction: column;
    }
    .df-cardface__name { font-weight: 700; font-size: calc(var(--w) * 0.105); line-height: 1.15; }
    .df-cardface__amt {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 6px;
      font-size: calc(var(--w) * 0.085);
    }
    .df-cardface__amt b {
      font-family: var(--font-display);
      font-weight: 800;
      font-size: calc(var(--w) * 0.17);
      margin-right: 2px;
    }
  `,
  host: {
    '[style.--suit]': `'var(--suit-' + card().suit + ')'`,
    '[style.--on-suit]': `'var(--on-' + card().suit + ')'`,
    '[style.--suit-text]': `'var(--suit-text-' + card().suit + ')'`,
  },
})
export class CardFaceMiniComponent {
  readonly card = input.required<CardFaceModel>();
  protected readonly symbol = SUIT_SYMBOL;

  /** Suits never rely on colour alone (§9): the label names the suit and the group. */
  protected readonly label = computed(() => {
    const c = this.card();
    const unit = c.exercise?.measure === 'seconds' ? 'seconds' : 'reps';
    const name = c.exercise ? `, ${c.exercise.name}, ${c.amount} ${unit}` : ', joker';
    return `${c.rank === 'JOKER' ? 'Joker' : c.rank + ' of ' + SUIT_NAME[c.suit]}${name}${c.suitLabel ? ', ' + c.suitLabel : ''}`;
  });
}
