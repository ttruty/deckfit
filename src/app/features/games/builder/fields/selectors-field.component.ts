import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { SelectorFieldComponent } from './selector-field.component';

/**
 * A list of selectors (their cards, in order, de-duplicated by the engine). Emits a plain string
 * for one selector and an array for several, like hand-written games.
 */
@Component({
  selector: 'df-selectors-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, SelectorFieldComponent],
  template: `
    <div class="list" role="group" [attr.aria-label]="label()">
      @for (sel of list(); track $index; let i = $index) {
        <span class="row item">
          <df-selector-field [value]="sel" [label]="i === 0 ? label() : 'and'" [allowIntent]="allowIntent()" (valueChange)="set(i, $event)" />
          @if (list().length > min()) {
            <button type="button" class="icon-btn" (click)="removeAt(i)" [attr.aria-label]="'Remove selector ' + (i + 1)"><mat-icon>close</mat-icon></button>
          }
        </span>
      }
      <button type="button" class="text-btn" (click)="add()">+ More cards</button>
    </div>
  `,
  styleUrl: './_controls.scss',
  styles: `.list { display: grid; gap: 4px; justify-items: start; } .item { align-items: end; }`,
})
export class SelectorsFieldComponent {
  readonly value = input.required<unknown>();
  readonly label = input('Cards');
  readonly min = input(1);
  readonly allowIntent = input(true);
  /** Always emit an array (e.g. `match` requires one). */
  readonly asArray = input(false);
  readonly valueChange = output<string | string[]>();

  protected readonly list = computed(() => {
    const v = this.value();
    return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : [];
  });

  protected set(i: number, sel: string): void {
    this.emit(this.list().map((s, j) => (j === i ? sel : s)));
  }

  protected add(): void {
    this.emit([...this.list(), 'table.last']);
  }

  protected removeAt(i: number): void {
    this.emit(this.list().filter((_, j) => j !== i));
  }

  private emit(list: string[]): void {
    this.valueChange.emit(list.length === 1 && !this.asArray() ? list[0] : list);
  }
}
