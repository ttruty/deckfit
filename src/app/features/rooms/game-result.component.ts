import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FireworksComponent } from '../../shared/ui/fireworks/fireworks.component';

export interface FinalScore {
  id: string;
  name: string;
  score: number;
  isMe: boolean;
  /** Shared by ties. */
  place: number;
  won: boolean;
}

/** The end of a game, said plainly: who won, then everyone's score with its unit spelled out. */
@Component({
  selector: 'df-game-result',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FireworksComponent],
  template: `
    @if (celebrating()) { <df-fireworks [count]="iWon() ? 5 : 3" /> }
    <h2 id="over-title" [class.won]="iWon()">{{ headline() }}</h2>
    <ol>
      @for (s of scores(); track s.id) {
        <li [class.me]="s.isMe" [class.won]="s.won" [class.lost]="!s.won && anyWinner()" [style.--place]="s.place">
          <span class="place" aria-hidden="true">{{ s.won ? '🏆' : s.place }}</span>
          <span class="who">{{ s.name }}@if (s.isMe) { <span class="you">(you)</span> }</span>
          <span class="score"><strong>{{ s.score }}</strong> {{ unit() }}</span>
        </li>
      }
    </ol>
    <p class="hint">{{ help() }}</p>
  `,
  styles: `
    :host { position: relative; display: grid; gap: 12px; justify-items: center; }
    h2 { margin: 0; font-family: var(--font-display); font-weight: 800; font-size: 2.4rem; line-height: 1.1; text-align: center; }
    ol { margin: 0; padding: 0; list-style: none; width: min(100%, 420px); display: grid; gap: 6px; }
    li {
      display: grid; grid-template-columns: 2ch 1fr auto; gap: 10px; align-items: baseline;
      padding: 8px 12px; border-radius: 12px; font: var(--mat-sys-body-large);
      background: var(--mat-sys-surface-container-high);
    }
    li.won { background: var(--mat-sys-primary-container); color: var(--mat-sys-on-primary-container); }
    li.me .who { font-weight: 700; }
    .place { font-variant-numeric: tabular-nums; color: var(--mat-sys-on-surface-variant); }
    .you { font: var(--mat-sys-body-small); opacity: 0.75; margin-left: 4px; }
    .score strong { font-family: var(--font-display); font-size: 1.5rem; margin-right: 2px; }
    .hint { margin: 0; font: var(--mat-sys-body-small); color: var(--mat-sys-on-surface-variant); text-align: center; }

    /* The winner lands with a bounce; everyone else slumps a little. Both are one-shot, and
       neither runs when the player asked for less motion (§9). */
    @media (prefers-reduced-motion: no-preference) {
      h2.won { animation: land 520ms cubic-bezier(0.2, 1.4, 0.4, 1) both; }
      li.won { animation: pop 620ms cubic-bezier(0.2, 1.3, 0.4, 1) 120ms both; }
      li.lost { animation: slump 420ms ease-out calc(80ms * var(--place, 1)) both; }
    }

    @keyframes land {
      0% { transform: scale(0.72) translateY(-10px); opacity: 0; }
      60% { transform: scale(1.06); opacity: 1; }
      100% { transform: scale(1); }
    }
    @keyframes pop {
      0% { transform: scale(0.94); }
      55% { transform: scale(1.04); }
      100% { transform: scale(1); }
    }
    @keyframes slump {
      0% { transform: translateY(-6px); opacity: 0.9; filter: none; }
      100% { transform: translateY(0); opacity: 0.72; filter: saturate(0.55); }
    }
  `,
})
export class GameResultComponent {
  readonly headline = input.required<string>();
  readonly scores = input.required<readonly FinalScore[]>();
  /** Set false where a celebration would be odd (an abandoned game). */
  readonly celebrate = input(true);
  /** What the number means: "rounds won" or "points". */
  readonly unit = input.required<string>();
  readonly help = input('');

  protected readonly anyWinner = computed(() => this.scores().some((s) => s.won));
  protected readonly iWon = computed(() => this.scores().some((s) => s.won && s.isMe));
  /** Celebrate your own win — or anyone's if you were only watching. Losing just slumps. */
  protected readonly celebrating = computed(() => this.celebrate() && this.anyWinner() && (this.iWon() || !this.scores().some((s) => s.isMe)));
}
