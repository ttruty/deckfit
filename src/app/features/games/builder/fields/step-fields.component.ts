import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ASSIGN_TARGETS, PLAYER_ZONES } from '../../../../domain/models/game.schema';
import type { Block } from '../model/blocks';
import { ConditionEditorComponent } from './condition-editor.component';
import { NumberRefFieldComponent } from './number-ref-field.component';
import { SelectorFieldComponent } from './selector-field.component';
import { SelectorsFieldComponent } from './selectors-field.component';
import { SINGLE_ZONES, ZONE_LABEL, setIn } from './labels';
import { SelectValueDirective } from './select-value.directive';

const ASSIGN_LABEL: Record<(typeof ASSIGN_TARGETS)[number], string> = {
  current: 'The acting player', each: 'Every player', winners: 'Round winners', losers: 'Everyone but the winners', owner: 'Whoever held each card',
};

/** The editable parameters of one block, by primitive. Emits the whole new step body. */
@Component({
  selector: 'df-step-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SelectValueDirective, ConditionEditorComponent, NumberRefFieldComponent, SelectorFieldComponent, SelectorsFieldComponent],
  templateUrl: './step-fields.component.html',
  styleUrl: './_controls.scss',
  styles: `:host { display: grid; gap: 8px; } .help { margin: 0; font: var(--mat-sys-body-small); color: var(--mat-sys-on-surface-variant); }`,
})
export class StepFieldsComponent {
  readonly block = input.required<Block>();
  readonly bodyChange = output<Record<string, unknown>>();

  protected readonly zones = SINGLE_ZONES;
  protected readonly dealTargets = [...SINGLE_ZONES, ...PLAYER_ZONES];
  protected readonly zoneLabel = ZONE_LABEL;
  protected readonly assignTargets = ASSIGN_TARGETS;
  protected readonly assignLabel = ASSIGN_LABEL;

  protected readonly body = computed(() => this.block().body);
  /** The object under the step's own key, for primitives shaped `{ kind: { … } }`. */
  protected readonly inner = computed(() => {
    const v = this.body()[this.block().kind];
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  });
  protected readonly assignCards = computed(() => {
    const a = this.body()['assign'];
    return a && typeof a === 'object' && !Array.isArray(a) ? (a as Record<string, unknown>)['cards'] : a;
  });
  protected readonly winnersMode = computed(() => {
    const w = this.inner();
    return w['by'] === 'poker' ? 'poker' : w['by'] === 'empty-team' ? 'empty-team' : ((w['wins'] as string) ?? 'high');
  });

  /** Sets a key of the step (path from the step root); `undefined` removes it. */
  protected set(path: (string | number)[], value: unknown): void {
    this.bodyChange.emit(setIn(this.body(), path, value));
  }

  protected setInner(key: string, value: unknown): void {
    this.set([this.block().kind, key], value === '' ? undefined : value);
  }

  protected faceUpValue(v: unknown): string {
    return v === true ? 'up' : v === false ? 'down' : '';
  }

  protected parseFaceUp(v: string): boolean | undefined {
    return v === 'up' ? true : v === 'down' ? false : undefined;
  }

  protected onlyValue(): string {
    return ((this.inner()['only'] as { measure?: string } | undefined)?.measure) ?? '';
  }

  protected setOnly(v: string): void {
    this.setInner('only', v ? { measure: v } : undefined);
  }

  /** Assign: short form (just cards) unless a target or fixed time is set. */
  protected setAssign(patch: { cards?: unknown; to?: string; timedSec?: unknown }): void {
    const a = this.body()['assign'];
    const current = a && typeof a === 'object' && !Array.isArray(a) ? (a as Record<string, unknown>) : { cards: a };
    const next: Record<string, unknown> = { ...current, ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '' || (k === 'to' && next[k] === 'current')) delete next[k];
    this.set(['assign'], Object.keys(next).length === 1 ? next['cards'] : next);
  }

  protected assignOption(key: 'to' | 'timedSec'): unknown {
    const a = this.body()['assign'];
    return a && typeof a === 'object' && !Array.isArray(a) ? (a as Record<string, unknown>)[key] : undefined;
  }

  protected setTimerKind(kind: string): void {
    const { restSeconds, ...timer } = this.inner();
    this.set(['timer'], kind === 'interval' ? { ...timer, kind, restSeconds: restSeconds ?? 10 } : { ...timer, kind });
  }

  protected setWinnersMode(mode: string): void {
    const cards = (this.inner()['cards'] as string) ?? 'hands.first';
    const next = mode === 'poker' ? { cards: this.inner()['cards'] ?? 'hands.all', by: 'poker' }
      : mode === 'empty-team' ? { by: 'empty-team' }
      : { cards, wins: mode };
    this.set(['winners'], next);
  }
}
