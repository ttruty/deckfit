import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { DfIconComponent } from '../../shared/ui/icon/df-icon.component';

export interface QuickPickOption {
  id: string;
  name: string;
  /** The line under the name: "54 cards · no equipment", "1 player · one card at a time". */
  meta: string;
}

export interface QuickPickData {
  title: string;
  options: QuickPickOption[];
  selected: string;
}

/**
 * Picks the deck or the game for Quick start. A list of radios rather than a select: the meta
 * line matters as much as the name, and it has to work as a sheet on a phone.
 */
@Component({
  selector: 'df-quick-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, DfIconComponent],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      <ul class="df-list">
        @for (option of data.options; track option.id) {
          <li>
            <label class="df-row option" [class.on]="chosen() === option.id">
              <input type="radio" name="quick-pick" [value]="option.id" [checked]="chosen() === option.id"
                     (change)="chosen.set(option.id)" />
              <span class="text">
                <span class="name">{{ option.name }}</span>
                <span class="meta">{{ option.meta }}</span>
              </span>
              <df-icon name="check" />
            </label>
          </li>
        }
      </ul>
    </mat-dialog-content>
    <mat-dialog-actions>
      <button type="button" class="df-btn df-btn--text" (click)="ref.close()">Cancel</button>
      <button type="button" class="df-btn df-btn--primary" (click)="ref.close(chosen())">Choose</button>
    </mat-dialog-actions>
  `,
  styles: `
    h2 { font-family: var(--font-display); font-weight: 700; font-size: 1.4rem; }
    mat-dialog-content { max-height: 60vh; }
    .option {
      position: relative;
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 64px;
      padding: 8px 14px;
      cursor: pointer;
      &.on { outline: 2px solid var(--df-primary); }
      &:hover { background: var(--df-row-hover); }
      &:has(input:focus-visible) { outline: 3px solid var(--df-primary); outline-offset: 2px; }
      input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; }
      df-icon { display: none; color: var(--df-primary); }
      &.on df-icon { display: contents; }
    }
    .text { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .name { font-size: 1.0625rem; font-weight: 500; }
    .meta { font-size: 0.875rem; color: var(--df-text-muted); }
    mat-dialog-actions { justify-content: flex-end; gap: 8px; }
  `,
})
export class QuickPickerDialog {
  protected readonly ref = inject(MatDialogRef<QuickPickerDialog, string | undefined>);
  protected readonly data = inject<QuickPickData>(MAT_DIALOG_DATA);
  protected readonly chosen = signal(this.data.selected);
}
