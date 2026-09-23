import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TOUR_STEPS } from './tour-steps';

/**
 * The welcome guide (§12a): a few steps with Back / Next, skippable at any point. Closing it —
 * however it closes — counts as seen, so it never interrupts twice; Settings can replay it.
 */
@Component({
  selector: 'df-tour',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatDialogModule, MatIconModule],
  template: `
    <div class="tour" [attr.data-suit]="step().suit">
      <p class="count" aria-live="polite">Step {{ index() + 1 }} of {{ steps.length }}</p>
      <span class="badge" aria-hidden="true"><mat-icon>{{ step().icon }}</mat-icon></span>
      <h2 mat-dialog-title>{{ step().title }}</h2>
      <mat-dialog-content><p>{{ step().body }}</p></mat-dialog-content>

      <ol class="dots" aria-hidden="true">
        @for (s of steps; track s.title) { <li [class.on]="s === step()"></li> }
      </ol>

      <mat-dialog-actions>
        @if (!last()) {
          <button mat-button type="button" (click)="close()">Skip</button>
        }
        <span class="spacer"></span>
        @if (index() > 0) {
          <button mat-button type="button" (click)="back()">Back</button>
        }
        <button mat-flat-button type="button" class="next" (click)="next()">
          {{ last() ? 'Start playing' : 'Next' }}
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: `
    .tour {
      display: grid; justify-items: center; text-align: center; gap: 8px;
      /* The dialog surface has no padding of its own once title/content/actions give theirs up. */
      padding: 24px 24px 16px;
      --suit: var(--suit-hearts); --on-suit: var(--on-hearts);
      &[data-suit='diamonds'] { --suit: var(--suit-diamonds); --on-suit: var(--on-diamonds); }
      &[data-suit='clubs'] { --suit: var(--suit-clubs); --on-suit: var(--on-clubs); }
      &[data-suit='spades'] { --suit: var(--suit-spades); --on-suit: var(--on-spades); }
      &[data-suit='joker'] { --suit: var(--suit-joker); --on-suit: var(--on-joker); }
    }
    .count { margin: 0; font: var(--mat-sys-label-medium); color: var(--mat-sys-on-surface-variant); }
    .badge {
      display: grid; place-items: center; width: 72px; height: 72px; border-radius: 50%;
      background: var(--suit); color: var(--on-suit);
      mat-icon { font-size: 40px; width: 40px; height: 40px; }
    }
    h2 { padding: 0; font-family: var(--font-display); font-weight: 800; font-size: 1.8rem; line-height: 1.1; }
    mat-dialog-content { padding: 0; font: var(--mat-sys-body-large); }
    p { margin: 0; }
    .dots { display: flex; gap: 8px; list-style: none; margin: 8px 0 0; padding: 0; }
    .dots li {
      width: 8px; height: 8px; border-radius: 50%; background: var(--mat-sys-outline-variant);
      &.on { background: var(--suit); }
    }
    mat-dialog-actions { width: 100%; padding: 8px 0 0; gap: 8px; }
    .spacer { flex: 1; }
    .next { min-height: 48px; min-width: 120px; }
    @media (prefers-reduced-motion: no-preference) {
      .badge { transition: background-color 200ms ease; }
    }
  `,
})
export class TourDialog {
  private readonly ref = inject(MatDialogRef<TourDialog>);
  protected readonly steps = TOUR_STEPS;
  protected readonly index = signal(0);
  protected readonly step = computed(() => this.steps[this.index()]);
  protected readonly last = computed(() => this.index() === this.steps.length - 1);

  protected next(): void {
    if (this.last()) this.close();
    else this.index.update((i) => i + 1);
  }

  protected back(): void {
    this.index.update((i) => Math.max(0, i - 1));
  }

  protected close(): void {
    this.ref.close();
  }
}
