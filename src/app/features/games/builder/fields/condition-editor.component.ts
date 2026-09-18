import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { PLAYER_ZONES, type ConditionKind } from '../../../../domain/models/game.schema';
import { GameBuilderStore } from '../game-builder.store';
import { conditionKind } from '../model/validation';
import { NumberRefFieldComponent } from './number-ref-field.component';
import { SelectorFieldComponent } from './selector-field.component';
import { SelectorsFieldComponent } from './selectors-field.component';
import { COMPARISONS, CONDITION_DEFAULT, CONDITION_LABEL, FLAG_SUGGESTIONS, SINGLE_ZONES, ZONE_LABEL, setIn } from './labels';
import { SelectValueDirective } from './select-value.directive';

const MATCH_ON = ['suit', 'rank', 'color', 'adjacent-rank'];

/** Edits one condition; all/any/not nest further condition editors. */
@Component({
  selector: 'df-condition-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SelectValueDirective, MatIconModule, NumberRefFieldComponent, SelectorFieldComponent, SelectorsFieldComponent],
  templateUrl: './condition-editor.component.html',
  styleUrl: './_controls.scss',
  styles: `
    :host { display: block; }
    .cond { display: grid; gap: 6px; }
    .nested { display: grid; gap: 6px; padding-left: 12px; border-left: 3px solid var(--mat-sys-tertiary); }
    .nested-item { display: flex; gap: 4px; align-items: start; }
  `,
})
export class ConditionEditorComponent {
  protected readonly store = inject(GameBuilderStore);
  readonly value = input<unknown>();
  readonly label = input('When');
  readonly depth = input(0);
  readonly valueChange = output<unknown>();

  protected readonly kinds = Object.keys(CONDITION_LABEL) as ConditionKind[];
  protected readonly kindLabel = CONDITION_LABEL;
  protected readonly zones = SINGLE_ZONES;
  protected readonly playerZones = PLAYER_ZONES;
  protected readonly zoneLabel = ZONE_LABEL;
  protected readonly comparisons = COMPARISONS;
  protected readonly flags = FLAG_SUGGESTIONS;
  protected readonly matchOn = MATCH_ON;
  protected readonly flagListId = `flags-${Math.random().toString(36).slice(2)}`;

  protected readonly kind = computed(() => conditionKind(this.value()));
  protected readonly obj = computed(() => (this.value() && typeof this.value() === 'object' ? (this.value() as Record<string, unknown>) : {}));
  protected readonly op = computed(() => COMPARISONS.find((c) => c.op in this.obj())?.op ?? 'gte');
  protected readonly children = computed(() => {
    const k = this.kind();
    return k === 'all' || k === 'any' ? ((this.obj()[k] as unknown[]) ?? []) : [];
  });
  protected readonly enumSettings = computed(() => this.store.settingDefs().filter(([, d]) => d.type === 'enum').map(([key, d]) => ({ key, label: d.label ?? key })));
  protected readonly matchOnSetting = computed(() => {
    const on = this.obj()['on'];
    return on && typeof on === 'object' ? ((on as { setting: string }).setting ?? '') : null;
  });

  protected setKind(kind: ConditionKind): void {
    this.valueChange.emit(structuredClone(CONDITION_DEFAULT[kind]));
  }

  protected set(key: string, v: unknown): void {
    this.valueChange.emit(setIn(this.obj(), [key], v));
  }

  protected setOp(op: string): void {
    const current = this.obj()[this.op()];
    const next: Record<string, unknown> = { ...this.obj() };
    for (const c of COMPARISONS) delete next[c.op];
    next[op] = current ?? 1;
    this.valueChange.emit(next);
  }

  protected setChild(i: number, v: unknown): void {
    const k = this.kind() as 'all' | 'any';
    this.valueChange.emit({ [k]: this.children().map((c, j) => (j === i ? v : c)) });
  }

  protected addChild(): void {
    const k = this.kind() as 'all' | 'any';
    this.valueChange.emit({ [k]: [...this.children(), 'draw.empty'] });
  }

  protected removeChild(i: number): void {
    const k = this.kind() as 'all' | 'any';
    this.valueChange.emit({ [k]: this.children().filter((_, j) => j !== i) });
  }

  protected setEquals(raw: string): void {
    const v = raw === 'true' ? true : raw === 'false' ? false : raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
    this.set('equals', v);
  }

  protected setMatchOnMode(mode: string): void {
    if (mode === 'fixed') this.set('on', 'suit');
    else if (mode === 'new') this.set('on', { setting: this.store.exposeEnum('Match on', [...MATCH_ON], typeof this.obj()['on'] === 'string' ? (this.obj()['on'] as string) : 'suit') });
    else this.set('on', { setting: mode });
  }
}
