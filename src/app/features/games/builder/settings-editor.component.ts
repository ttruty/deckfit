import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { SettingDef } from '../../../domain/models/game.schema';
import { SUITS } from '../../../domain/models/schemas';
import { SUIT_NAME, SUIT_SYMBOL } from '../../../shared/labels';
import { setIn } from './fields/labels';
import { GameBuilderStore } from './game-builder.store';
import { SelectValueDirective } from './fields/select-value.directive';

const NEW_DEFS: Record<SettingDef['type'], SettingDef> = {
  number: { type: 'number', min: 1, max: 20, step: 1, default: 5 },
  enum: { type: 'enum', options: ['easy', 'hard'], default: 'easy' },
  boolean: { type: 'boolean', default: false },
  suits: { type: 'suits', default: ['hearts', 'diamonds', 'clubs', 'spades'] },
};

/**
 * §6.4 step 5: the settings a routine can tune for this game. Values become settings with "Make
 * adjustable" on a block field, or here directly; they're referenced from blocks as `{ setting }`.
 */
@Component({
  selector: 'df-settings-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SelectValueDirective, MatIconModule],
  templateUrl: './settings-editor.component.html',
  styleUrl: './settings-editor.component.scss',
})
export class SettingsEditorComponent {
  protected readonly store = inject(GameBuilderStore);
  private readonly snack = inject(MatSnackBar);
  protected readonly newType = signal<SettingDef['type']>('number');
  protected readonly newLabel = signal('');
  protected readonly suits = SUITS.filter((s) => s !== 'joker');
  protected readonly suitSymbol = SUIT_SYMBOL;
  protected readonly suitName = SUIT_NAME;

  protected readonly entries = computed(() =>
    this.store.settingDefs().map(([key, def]) => ({ key, def: def as SettingDef & Record<string, unknown>, uses: this.store.uses(key) })),
  );

  protected problems(key: string): string[] {
    return this.store.validation().problems.flatMap((p) => ('field' in p && p.field.startsWith(`settingsSchema.${key}`) ? [p.message] : []));
  }

  protected patch(key: string, def: Record<string, unknown>, path: string[], value: unknown): void {
    this.store.updateSetting(key, setIn(def, path, value));
  }

  protected num(raw: string): number | undefined {
    return raw === '' ? undefined : Number(raw);
  }

  protected options(raw: string): string[] {
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }

  protected toggleSuit(key: string, def: Record<string, unknown>, suit: string, on: boolean): void {
    const current = (def['default'] as string[]) ?? [];
    this.patch(key, def, ['default'], on ? [...current, suit] : current.filter((s) => s !== suit));
  }

  protected add(): void {
    const label = this.newLabel().trim() || 'Setting';
    this.store.addSetting(label, { ...NEW_DEFS[this.newType()], label } as SettingDef);
    this.newLabel.set('');
  }

  protected remove(key: string): void {
    const error = this.store.removeSetting(key);
    if (error) this.snack.open(error, 'OK', { duration: 6000 });
  }
}
