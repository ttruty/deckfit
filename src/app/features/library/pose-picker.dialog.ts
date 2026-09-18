import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { PoseLibraryService } from '../../core/content/pose-library.service';
import type { Prop } from '../../domain/models/schemas';
import { ExerciseFigureComponent } from '../../shared/ui/exercise-figure/exercise-figure.component';
import { poseGroup, poseLabel, searchPoses } from './exercise-form.model';

export interface PosePickerData {
  /** Which half of the movement is being chosen (start = the faint ghost figure). */
  which: 'start' | 'end';
  selected: string;
  /** Drawn on every option, so props line up with the pose you pick. */
  prop: Prop;
}

/** Visual pose grid over poses.json: every pose drawn as the figure it produces (§9a). */
@Component({
  selector: 'df-pose-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule, ExerciseFigureComponent],
  template: `
    <h2 mat-dialog-title>{{ data.which === 'start' ? 'Start pose' : 'End pose' }}</h2>
    <mat-dialog-content class="content">
      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="search">
        <mat-icon matPrefix>search</mat-icon>
        <mat-label>Search poses</mat-label>
        <input #q matInput type="search" (input)="query.set(q.value)" cdkFocusInitial />
      </mat-form-field>

      @for (group of groups(); track group.name) {
        <h3>{{ group.name }}</h3>
        <ul class="grid" [attr.aria-label]="group.name + ' poses'">
          @for (pose of group.poses; track pose) {
            <li>
              <button type="button" class="pose" [class.selected]="pose === picked()" [attr.aria-pressed]="pose === picked()"
                      [attr.data-pose]="pose" (click)="picked.set(pose)" (dblclick)="choose()">
                <df-exercise-figure [figure]="{ start: pose, end: pose, prop: data.prop }" aria-hidden="true" />
                <span class="label">{{ label(pose) }}</span>
              </button>
            </li>
          }
        </ul>
      } @empty {
        <p class="empty">No poses match “{{ query() }}”.</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button [disabled]="!picked()" (click)="choose()">Use this pose</button>
    </mat-dialog-actions>
  `,
  styles: `
    .content { display: grid; gap: 4px; }
    .search { width: min(100%, 320px); }
    h3 { margin: 12px 0 4px; font: var(--mat-sys-title-small); color: var(--mat-sys-on-surface-variant); }
    .grid { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); }
    .pose {
      display: grid; gap: 2px; justify-items: center; width: 100%; padding: 4px; cursor: pointer; font: inherit; color: inherit;
      background: var(--mat-sys-surface-container-low); border: 2px solid transparent; border-radius: 12px;
      &:hover { background: var(--mat-sys-surface-container-high); }
      &.selected { border-color: var(--mat-sys-primary); background: var(--mat-sys-primary-container); }
      &:focus-visible { outline: 3px solid var(--mat-sys-primary); outline-offset: 2px; }
    }
    df-exercise-figure { width: 100%; max-width: 88px; }
    .label { font: var(--mat-sys-label-small); text-align: center; overflow-wrap: anywhere; }
    .empty { color: var(--mat-sys-on-surface-variant); }
  `,
})
export class PosePickerDialog {
  protected readonly data = inject<PosePickerData>(MAT_DIALOG_DATA);
  private readonly dialog = inject<MatDialogRef<PosePickerDialog, string>>(MatDialogRef);
  private readonly poses = inject(PoseLibraryService).poses;

  protected readonly query = signal('');
  protected readonly picked = signal(this.data.selected);
  protected readonly label = poseLabel;

  protected readonly groups = computed(() => {
    const ids = searchPoses(Object.keys(this.poses() ?? {}), this.query());
    const byGroup = new Map<string, string[]>();
    for (const id of ids) byGroup.set(poseGroup(id), [...(byGroup.get(poseGroup(id)) ?? []), id]);
    return [...byGroup].map(([name, poses]) => ({ name, poses }));
  });

  constructor() {
    inject(PoseLibraryService).load();
  }

  protected choose(): void {
    if (this.picked()) this.dialog.close(this.picked());
  }
}
