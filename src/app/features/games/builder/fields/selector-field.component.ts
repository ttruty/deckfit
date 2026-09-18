import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { PICK_LABEL, PICK_OPTIONS, SELECTOR_ZONES, ZONE_LABEL } from './labels';
import { SelectValueDirective } from './select-value.directive';

/** One card selector: `<zone>.<pick>` or `intent.card`. */
@Component({
  selector: 'df-selector-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SelectValueDirective],
  template: `
    <span class="row">
      <label class="ctl">{{ label() }}
        <select [value]="zone()" (change)="setZone($any($event.target).value)">
          @for (z of zones; track z) { <option [value]="z">{{ zoneLabel[z] }}</option> }
          @if (allowIntent()) { <option value="intent.card">The played card</option> }
        </select>
      </label>
      @if (zone() !== 'intent.card') {
        <label class="ctl">Which
          <select [value]="pick()" (change)="valueChange.emit(zone() + '.' + $any($event.target).value)">
            @for (p of picks; track p) { <option [value]="p">{{ pickLabel[p] }}</option> }
          </select>
        </label>
      }
    </span>
  `,
  styleUrl: './_controls.scss',
})
export class SelectorFieldComponent {
  readonly value = input.required<string>();
  readonly label = input('Cards');
  readonly allowIntent = input(true);
  readonly valueChange = output<string>();
  protected readonly zones = SELECTOR_ZONES;
  protected readonly picks = PICK_OPTIONS;
  protected readonly zoneLabel = ZONE_LABEL;
  protected readonly pickLabel = PICK_LABEL;
  protected readonly zone = computed(() => (this.value() === 'intent.card' ? 'intent.card' : this.value().split('.')[0]));
  protected readonly pick = computed(() => this.value().split('.')[1] ?? 'all');

  protected setZone(zone: string): void {
    this.valueChange.emit(zone === 'intent.card' ? zone : `${zone}.${this.pick() || 'all'}`);
  }
}
