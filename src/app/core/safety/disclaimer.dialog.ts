import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { DatePipe } from '@angular/common';

export interface DisclaimerData {
  /** First run: the notice must be accepted. Otherwise it's just being re-read from Settings. */
  mustAccept: boolean;
  acceptedAt?: number;
}

/** §12 safety notice. Shown once on first run and re-readable from Settings. */
@Component({
  selector: 'df-disclaimer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>Before you start</h2>
    <mat-dialog-content>
      <p>DeckFit is a workout game, not medical advice.</p>
      <ul>
        <li>Check with a doctor or a qualified trainer before starting a new kind of exercise, especially if you're pregnant, injured, or managing a health condition.</li>
        <li>Warm up, use a weight and a pace you can control, and keep the difficulty and rep filters where they feel right for you.</li>
        <li>Stop straight away if something hurts, and don't push through dizziness or chest pain.</li>
        <li>Cards can deal big numbers. Use the rep multiplier and the maximum reps per task to keep a workout sane.</li>
      </ul>
      <p>You're responsible for your own safety while you play.</p>
      @if (!data.mustAccept && data.acceptedAt) {
        <p class="accepted">Accepted on {{ data.acceptedAt | date: 'longDate' }}.</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (data.mustAccept) {
        <button mat-flat-button [mat-dialog-close]="true" cdkFocusInitial>I understand</button>
      } @else {
        <button mat-button mat-dialog-close cdkFocusInitial>Close</button>
      }
    </mat-dialog-actions>
  `,
  styles: `
    ul { margin: 0 0 12px; padding-left: 20px; display: grid; gap: 6px; }
    p { margin: 0 0 12px; }
    .accepted { color: var(--mat-sys-on-surface-variant); font: var(--mat-sys-body-small); }
  `,
})
export class DisclaimerDialog {
  protected readonly data = inject<DisclaimerData>(MAT_DIALOG_DATA);
}
