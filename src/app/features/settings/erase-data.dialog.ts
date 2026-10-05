import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import type { EraseSummary } from '../../core/db/erase.service';

export interface EraseData {
  scope: 'history' | 'all';
  summary: EraseSummary;
  /** True when challenges are shared with a backend, so an erase reaches beyond this device. */
  shared: boolean;
}

/**
 * The confirmation for §10's two erases. Deleting here is final — there is no undo snackbar as
 * there is for a single deck — so the dialog names exactly what goes, and the full erase asks
 * for a second, deliberate tap rather than a typed phrase.
 */
@Component({
  selector: 'df-erase-data',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>{{ data.scope === 'all' ? 'Erase everything on this device?' : 'Clear your workout history?' }}</h2>
    <mat-dialog-content>
      @if (data.scope === 'history') {
        <p>
          {{ count(data.summary.workouts, 'saved workout') }} will be deleted, and your streak and totals
          start again from today. Your decks, games and routines stay.
        </p>
      } @else {
        <p>This device goes back to how it was before you first opened DeckFit. That means:</p>
        <ul>
          <li>{{ count(data.summary.workouts, 'saved workout') }} — history, streak and totals</li>
          <li>
            {{ count(data.summary.routines, 'routine') }}, {{ count(data.summary.decks, 'deck') }},
            {{ count(data.summary.games, 'game') }} and {{ count(data.summary.exercises, 'exercise') }} you made
          </li>
          <li>your name, your settings, and this device’s Habits connection</li>
          @if (data.shared) {
            <li>your seat and your reported days in every challenge — the challenges themselves stay for everyone else</li>
          }
        </ul>
        <p>The built-in decks and games come back straight away. Export first if you want to keep anything.</p>
      }
      <p class="final">This can’t be undone.</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close cdkFocusInitial>Cancel</button>
      @if (data.scope === 'history') {
        <button mat-flat-button class="confirm" [mat-dialog-close]="true">Clear history</button>
      } @else if (armed()) {
        <button mat-flat-button class="confirm" [mat-dialog-close]="true">Yes, erase everything</button>
      } @else {
        <button mat-stroked-button class="danger" type="button" (click)="armed.set(true)">Erase everything</button>
      }
    </mat-dialog-actions>
  `,
  styles: `
    p { margin: 0 0 12px; }
    ul { margin: 0 0 12px; padding-left: 20px; display: grid; gap: 6px; }
    .final { font-weight: 500; }
    /* The button that actually deletes is filled in the error colour; Material's own token is
       set on a host-level theme, so the pair is written here where specificity wins. */
    .confirm { background: var(--mat-sys-error); color: var(--mat-sys-on-error); }
    .danger { color: var(--mat-sys-error); }
  `,
})
export class EraseDataDialog {
  protected readonly data = inject<EraseData>(MAT_DIALOG_DATA);
  /** The full erase takes two taps: the first one only turns the second into the real button. */
  protected readonly armed = signal(false);

  protected count(n: number, noun: string): string {
    return `${n} ${noun}${n === 1 ? '' : 's'}`;
  }
}
