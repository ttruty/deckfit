import { CdkDrag, CdkDragPlaceholder, CdkDropList } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GameBuilderStore } from './game-builder.store';
import { PRIMITIVES, type BlockGroup } from './model/blocks';

const GROUPS: BlockGroup[] = ['Cards', 'Tasks', 'Flow', 'Scoring', 'Hidden info'];

/** Drag a primitive from here into any step list (copies; nothing can be dropped back). */
@Component({
  selector: 'df-block-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CdkDropList, CdkDrag, CdkDragPlaceholder, MatIconModule],
  template: `
    <h2 id="palette-title">Steps</h2>
    <p class="hint">Drag into a list, or use “Add step”.</p>
    <div cdkDropList id="palette" [cdkDropListConnectedTo]="store.listIds()" cdkDropListSortingDisabled [cdkDropListEnterPredicate]="never"
         aria-labelledby="palette-title">
      @for (g of groups; track g.name) {
        <h3>{{ g.name }}</h3>
        <ul>
          @for (p of g.items; track p.kind) {
            <li cdkDrag [cdkDragData]="{ kind: p.kind }" class="item" [attr.data-palette]="p.kind" [title]="p.help">
              <mat-icon aria-hidden="true">{{ p.icon }}</mat-icon>{{ p.label }}
              <div *cdkDragPlaceholder class="drop-line" aria-hidden="true"></div>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    :host { display: grid; gap: 4px; align-content: start; }
    h2 { margin: 0; font: var(--mat-sys-title-medium); }
    h3 { margin: 8px 0 4px; font: var(--mat-sys-label-medium); color: var(--mat-sys-on-surface-variant); text-transform: uppercase; }
    .hint { margin: 0; font: var(--mat-sys-body-small); color: var(--mat-sys-on-surface-variant); }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
    .item {
      display: flex; gap: 8px; align-items: center; padding: 6px 10px; border-radius: 10px; cursor: grab; font: var(--mat-sys-body-medium);
      background: var(--mat-sys-surface-container); border: 1px solid var(--mat-sys-outline-variant); touch-action: none;
      mat-icon { font-size: 20px; width: 20px; height: 20px; color: var(--mat-sys-on-surface-variant); }
    }
    .drop-line { height: 4px; border-radius: 2px; background: var(--mat-sys-primary); }
  `,
})
export class BlockPaletteComponent {
  protected readonly store = inject(GameBuilderStore);
  protected readonly groups = GROUPS.map((g) => ({ name: g, items: PRIMITIVES.filter((p) => p.group === g) }));
  protected readonly never = () => false;
}
