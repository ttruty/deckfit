import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ExerciseFigureComponent } from '../exercise-figure/exercise-figure.component';
import type { FigureSpec } from '../exercise-figure/figure-geometry';

export interface CardFaceModel {
  suit: 'hearts' | 'diamonds' | 'clubs' | 'spades' | 'joker';
  rank: string;
  suitLabel: string;              // from the deck's SuitMapping, e.g. "Legs"
  amount: number;                 // already multiplied by game settings
  exercise: { name: string; measure: 'reps' | 'seconds'; figure: FigureSpec } | null;
}

const PIP = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠', joker: '★' } as const;

@Component({
  selector: 'df-card-face',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ExerciseFigureComponent],
  template: `
    <article class="card-face" [class]="'card-face ' + card().suit" [attr.aria-label]="ariaLabel()">
      <div class="corner" aria-hidden="true">
        <span class="rank">{{ card().suit === 'joker' ? '★' : card().rank }}</span>
        @if (card().suit !== 'joker') { <span class="pip">{{ pip() }}</span> }
      </div>
      <div class="figure">
        @if (card().exercise; as ex) { <df-exercise-figure [figure]="ex.figure" /> }
      </div>
      <div class="plate">
        <div class="name">{{ card().exercise?.name ?? 'Wild card' }}</div>
        <div class="meta">
          @if (card().exercise; as ex) {
            <span class="amount">{{ card().amount }}<small>{{ unit() }}</small></span>
          } @else { <span class="amount">—</span> }
          <span class="group">{{ card().suitLabel }}</span>
        </div>
      </div>
    </article>
  `,
})
export class CardFaceComponent {
  readonly card = input.required<CardFaceModel>();
  readonly pip = computed(() => PIP[this.card().suit]);
  readonly unit = computed(() => (this.card().exercise?.measure === 'seconds' ? 'sec' : 'reps'));
  readonly ariaLabel = computed(() => {
    const c = this.card();
    if (!c.exercise) return 'Wild card';
    return `${c.rank} of ${c.suit}: ${c.exercise.name}, ${c.amount} ${this.unit()}, ${c.suitLabel}`;
  });
}
