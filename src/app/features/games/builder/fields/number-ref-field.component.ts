import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GameBuilderStore } from '../game-builder.store';
import { SelectValueDirective } from './select-value.directive';

type Mode = 'number' | 'setting' | 'var';

/** Core numeric settings any game can reference. */
const CORE_NUMBERS = [
  { key: 'faceCardValue', label: 'Face card value' }, { key: 'aceValue', label: 'Ace value' }, { key: 'maxRepCap', label: 'Max reps per task' },
  { key: 'timeLimitSec', label: 'Time limit (s)' }, { key: 'rounds', label: 'Rounds' },
];

/**
 * A DSL number: a literal, a user-tunable setting (`{ setting }`), or a counter (`{ var }`).
 * "Make adjustable" turns the current literal into a new number setting (§6.4 step 5).
 */
@Component({
  selector: 'df-number-ref',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SelectValueDirective, MatIconModule],
  template: `
    <span class="row">
      <label class="ctl">{{ label() }}
        @switch (mode()) {
          @case ('number') {
            <input type="number" [value]="asNumber()" [min]="min()" step="1" (input)="setNumber($any($event.target).value)" />
          }
          @case ('setting') {
            <select [value]="settingKey()" (change)="valueChange.emit({ setting: $any($event.target).value })">
              @if (!settingKey()) { <option value="" disabled>Choose…</option> }
              @for (s of numberSettings(); track s.key) { <option [value]="s.key">{{ s.label }}</option> }
            </select>
          }
          @case ('var') {
            <input type="text" [value]="varName()" placeholder="counter" (input)="valueChange.emit({ var: $any($event.target).value })" />
          }
        }
      </label>
      <label class="ctl">From
        <select [value]="mode()" (change)="setMode($any($event.target).value)">
          <option value="number">Fixed</option>
          <option value="setting">Setting</option>
          @if (allowVar()) { <option value="var">Counter</option> }
        </select>
      </label>
      @if (mode() === 'number' && typeof asNumber() === 'number') {
        <button type="button" class="icon-btn" (click)="expose()" [attr.aria-label]="'Make ' + label() + ' adjustable in routines'" title="Make adjustable in routines">
          <mat-icon>tune</mat-icon>
        </button>
      }
    </span>
  `,
  styleUrl: './_controls.scss',
})
export class NumberRefFieldComponent {
  private readonly store = inject(GameBuilderStore);
  readonly value = input<unknown>();
  readonly label = input.required<string>();
  readonly min = input(0);
  readonly allowVar = input(true);
  /** Used when switching back to a fixed number. */
  readonly fallback = input(1);
  readonly valueChange = output<unknown>();

  protected readonly mode = computed<Mode>(() => {
    const v = this.value();
    if (v && typeof v === 'object' && 'setting' in v) return 'setting';
    if (v && typeof v === 'object' && 'var' in v) return 'var';
    return 'number';
  });
  protected readonly asNumber = computed(() => (typeof this.value() === 'number' ? (this.value() as number) : ''));
  protected readonly settingKey = computed(() => ((this.value() as { setting?: string })?.setting ?? ''));
  protected readonly varName = computed(() => ((this.value() as { var?: string })?.var ?? ''));
  protected readonly numberSettings = computed(() => {
    const declared = this.store.settingDefs().filter(([, d]) => d.type === 'number').map(([key, d]) => ({ key, label: d.label ?? key }));
    return [...declared, ...CORE_NUMBERS.filter((c) => !declared.some((d) => d.key === c.key))];
  });

  protected setNumber(raw: string): void {
    this.valueChange.emit(raw === '' ? undefined : Number(raw));
  }

  protected setMode(mode: Mode): void {
    if (mode === 'number') this.valueChange.emit(this.fallback());
    if (mode === 'setting') this.valueChange.emit({ setting: this.numberSettings()[0]?.key ?? '' });
    if (mode === 'var') this.valueChange.emit({ var: 'round' });
  }

  protected expose(): void {
    const value = this.value();
    if (typeof value !== 'number') return;
    this.valueChange.emit({ setting: this.store.exposeNumber(this.label(), value) });
  }
}
