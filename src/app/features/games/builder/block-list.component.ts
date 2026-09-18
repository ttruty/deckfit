import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDragPlaceholder, CdkDropList } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import type { StepKind } from '../../../domain/models/game.schema';
import { StepFieldsComponent } from './fields/step-fields.component';
import { GameBuilderStore } from './game-builder.store';
import { PRIMITIVE, PRIMITIVES, type Block, type BlockGroup } from './model/blocks';
import { listId, parseListId, type ListRef } from './model/draft';

/** What a drag carries: an existing block, or a new one from the palette. */
export type BlockDragData = { uid: string } | { kind: StepKind };

const GROUPS: BlockGroup[] = ['Cards', 'Tasks', 'Flow', 'Scoring', 'Hidden info'];

/**
 * A list of rule blocks (a top-level step list or an if/repeat branch). Blocks can be dragged within
 * and between lists — including into nested branches — or moved with the block menu; "Add step"
 * inserts from the primitive catalog. Recursive: branches render another BlockListComponent.
 *
 * The drag placeholder is a thin insertion line on purpose: CDK measures nested lists when a drag
 * starts, and a full-height placeholder would push branches away from where CDK thinks they are.
 */
@Component({
  selector: 'df-block-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CdkDropList, CdkDrag, CdkDragHandle, CdkDragPlaceholder, MatIconModule, MatMenuModule, StepFieldsComponent],
  templateUrl: './block-list.component.html',
  styleUrl: './block-list.component.scss',
})
export class BlockListComponent {
  protected readonly store = inject(GameBuilderStore);
  readonly ref = input.required<ListRef>();
  readonly blocks = input.required<readonly Block[]>();
  readonly label = input.required<string>();
  readonly depth = input(0);

  protected readonly id = computed(() => listId(this.ref()));
  protected readonly primitive = PRIMITIVE;
  protected readonly groups = GROUPS.map((g) => ({ name: g, items: PRIMITIVES.filter((p) => p.group === g) }));

  /** A block can't be dropped into its own branches. */
  protected readonly canEnter = (drag: CdkDrag<BlockDragData>, drop: CdkDropList<ListRef>): boolean => {
    const ref = parseListId(drop.id);
    return !!ref && ('kind' in drag.data || this.store.canDrop(drag.data.uid, ref));
  };

  protected problems(uid: string): string[] {
    return this.store.validation().byBlock.get(uid) ?? [];
  }

  protected drop(event: CdkDragDrop<ListRef, unknown, BlockDragData>): void {
    const data = event.item.data;
    if ('kind' in data) this.store.add(data.kind, this.ref(), event.currentIndex);
    else this.store.move(data.uid, this.ref(), event.currentIndex);
  }

  protected add(kind: StepKind): void {
    this.store.add(kind, this.ref());
  }
}
