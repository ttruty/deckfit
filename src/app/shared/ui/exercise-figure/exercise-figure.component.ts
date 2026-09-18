import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { PoseLibraryService } from '../../../core/content/pose-library.service';
import { drawFigure, FigureSpec } from './figure-geometry';

@Component({
  selector: 'df-exercise-figure',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (drawing(); as d) {
      <!-- Unlabelled figures are decorative: the card, tile or option around them carries the name. -->
      <svg class="ex-figure" viewBox="-4 -8 108 104" [attr.role]="label() ? 'img' : null"
           [attr.aria-label]="label() || null" [attr.aria-hidden]="label() ? null : 'true'">
        <path class="ground" d="M-2 92.5H102" />
        @for (s of d.propBack; track $index) { <ng-container *ngTemplateOutlet="prop; context: { $implicit: s }" /> }
        @if (d.ghost; as g) {
          <g class="ghost">
            <path class="far" [attr.d]="g.far" /><path class="near" [attr.d]="g.near" />
            <circle class="head" [attr.cx]="g.head.cx" [attr.cy]="g.head.cy" [attr.r]="g.head.r" />
          </g>
        }
        <g class="main">
          <path class="far" [attr.d]="d.main.far" /><path class="near" [attr.d]="d.main.near" />
          <circle class="head" [attr.cx]="d.main.head.cx" [attr.cy]="d.main.head.cy" [attr.r]="d.main.head.r" />
        </g>
        @for (s of d.propFront; track $index) { <ng-container *ngTemplateOutlet="prop; context: { $implicit: s }" /> }
      </svg>
    }
    <ng-template #prop let-s>
      @if (s.kind === 'path') {
        <svg:path [class]="'prop ' + s.tone + (s.dashed ? ' dashed' : '')" [attr.d]="s.d" />
      } @else {
        <svg:circle [class]="'prop ' + s.tone + ' ' + s.fill" [attr.cx]="s.cx" [attr.cy]="s.cy" [attr.r]="s.r" />
      }
    </ng-template>
  `,
  imports: [NgTemplateOutlet],
  host: { class: 'df-exercise-figure' },
})
export class ExerciseFigureComponent {
  readonly figure = input.required<FigureSpec>();
  readonly label = input<string>('');
  private poses = inject(PoseLibraryService).poses;

  readonly drawing = computed(() => {
    const p = this.poses();
    return p ? drawFigure(this.figure(), p) : null;
  });

  constructor() {
    inject(PoseLibraryService).load();
  }
}
