import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { HowToPlayComponent } from './how-to-play.component';

export interface HowToPlayData {
  name: string;
  summary: string;
  steps: readonly string[];
  /** Settings in play, so the rules match what you're actually about to do. */
  facts?: readonly string[];
}

/** "Rules" while you're playing, without leaving the table. */
@Component({
  selector: 'df-how-to-play-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatDialogModule, HowToPlayComponent],
  template: `
    <h2 mat-dialog-title>{{ data.name }}</h2>
    <mat-dialog-content>
      <df-how-to-play [summary]="data.summary" [steps]="data.steps" />
      @if (data.facts?.length) {
        <ul class="facts">
          @for (fact of data.facts; track $index) { <li>{{ fact }}</li> }
        </ul>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button mat-dialog-close cdkFocusInitial>Got it</button>
    </mat-dialog-actions>
  `,
  styles: `
    .facts {
      margin: 12px 0 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 6px;
      font: var(--mat-sys-label-large);
      li { padding: 2px 10px; border-radius: 10px; background: var(--mat-sys-surface-container-high); }
    }
  `,
})
export class HowToPlayDialog {
  protected readonly data = inject<HowToPlayData>(MAT_DIALOG_DATA);
}
