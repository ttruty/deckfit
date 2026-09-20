import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { SUITS, type JokerRule } from '../../../domain/models/schemas';
import { SUIT_NAME, SUIT_SYMBOL } from '../../../shared/labels';
import type { HasUnsavedChanges } from '../../../shared/unsaved-changes.guard';
import { BlockListComponent } from './block-list.component';
import { BlockPaletteComponent } from './block-palette.component';
import { DryRunPanelComponent } from './dry-run-panel.component';
import { ConditionEditorComponent } from './fields/condition-editor.component';
import { NumberRefFieldComponent } from './fields/number-ref-field.component';
import { GameBuilderStore } from './game-builder.store';
import { getPath } from './model/draft';
import { fieldProblems } from './model/validation';
import { SettingsEditorComponent } from './settings-editor.component';
import { SelectValueDirective } from './fields/select-value.directive';

type TurnMode = 'steps' | 'simultaneous' | 'none';
type Requirement = { when: unknown; reason: string };

const JOKER_RULES: { value: JokerRule; label: string }[] = [
  { value: 'rest', label: 'Rest (30 s)' }, { value: 'skip', label: 'Skip' }, { value: 'wild', label: 'Wild exercise' }, { value: 'bonus-cardio', label: 'Bonus cardio' },
];

/** /games/new and /games/:gameId/edit — the custom game builder (§6.4). */
@Component({
  selector: 'df-game-builder',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SelectValueDirective, 
    RouterLink, MatButtonModule, MatIconModule, BlockListComponent, BlockPaletteComponent, ConditionEditorComponent,
    DryRunPanelComponent, NumberRefFieldComponent, SettingsEditorComponent,
  ],
  providers: [GameBuilderStore],
  templateUrl: './game-builder.component.html',
  styleUrl: './game-builder.component.scss',
})
export class GameBuilderComponent implements HasUnsavedChanges {
  /** Route param (edit); absent on /games/new. */
  readonly gameId = input<string>();
  /** Query param on /games/new: start as a copy of this game. */
  readonly from = input<string>();

  protected readonly store = inject(GameBuilderStore);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  private readonly document = inject(DOCUMENT);
  private leaving = false;

  protected readonly suits = SUITS.filter((s) => s !== 'joker');
  protected readonly suitSymbol = SUIT_SYMBOL;
  protected readonly suitName = SUIT_NAME;
  protected readonly jokerRules = JOKER_RULES;
  protected readonly multipliers = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

  /** Typed read-outs of the draft's game-level fields (the draft itself is unvalidated JSON). */
  protected readonly v = computed(() => {
    const g = this.store.draft().game;
    const at = (...path: string[]) => getPath(g, path);
    const n = (...path: string[]) => (typeof at(...path) === 'number' ? (at(...path) as number) : null);
    const turn = at('turn');
    return {
      name: String(at('name') ?? ''),
      summary: String(at('summary') ?? ''),
      howTo: (at('howTo') as string[] | undefined) ?? [],
      playersMin: n('players', 'min'),
      playersMax: n('players', 'max'),
      scoring: String(at('scoring') ?? 'total-work'),
      shuffle: at('setup', 'shuffle') === true,
      filterSuits: Array.isArray(at('setup', 'filter', 'suits')) ? (at('setup', 'filter', 'suits') as string[]) : null,
      filterSetting: (at('setup', 'filter', 'suits', 'setting') as string | undefined) ?? null,
      turnMode: (!turn || typeof turn !== 'object' ? 'none' : 'mode' in turn ? 'simultaneous' : 'steps') as TurnMode,
      race: at('race') === true,
      playAction: !!at('actions', 'play'),
      passAction: !!at('actions', 'pass'),
      timing: at('timing') ? { windowMs: n('timing', 'windowMs') } : null,
      endWhen: at('end', 'when'),
      endThen: Array.isArray(at('end', 'then')),
      defaults: {
        repMultiplier: n('defaults', 'repMultiplier'), faceCardValue: n('defaults', 'faceCardValue'), aceValue: n('defaults', 'aceValue'),
        jokerRule: (at('defaults', 'jokerRule') as string | undefined) ?? '', maxRepCap: n('defaults', 'maxRepCap'),
        timeLimitSec: n('defaults', 'timeLimitSec'), rounds: n('defaults', 'rounds'),
      },
      teamsSize: n('teams', 'size'),
      bluffMax: n('bluff', 'maxCards'),
      betting: at('betting') ? { maxBet: at('betting', 'maxBet') } : null,
      hidden: at('hidden') === true,
    };
  });
  protected readonly problemCount = computed(() => this.store.validation().problems.length);

  constructor() {
    effect(() => {
      const [gameId, from] = [this.gameId(), this.from()];
      untracked(() => void this.store.load({ gameId, from }));
    });
  }

  hasUnsavedChanges(): boolean {
    return !this.leaving && this.store.loaded() && this.store.dirty();
  }

  protected fp(prefix: string): string[] {
    return fieldProblems(this.store.validation(), prefix);
  }

  protected set(path: string[], value: unknown): void {
    this.store.setField(path, value);
  }

  protected num(raw: string): number | undefined {
    return raw === '' ? undefined : Number(raw);
  }

  /** Plain-language rules for this game (§6.3 `howTo`), shown in the catalog, lobby and in play. */
  protected setStep(i: number, text: string): void {
    const steps = [...this.v().howTo];
    steps[i] = text;
    this.set(['howTo'], steps);
  }

  protected addStep(): void {
    this.set(['howTo'], [...this.v().howTo, '']);
  }

  protected removeStep(i: number): void {
    const steps = this.v().howTo.filter((_, j) => j !== i);
    this.set(['howTo'], steps.length ? steps : undefined);
  }

  protected setTurnMode(mode: TurnMode): void {
    this.set(['turn'], mode === 'none' ? undefined : mode === 'steps' ? { steps: [] } : { mode: 'simultaneous', each: [], then: [] });
  }

  protected toggle(path: string[], on: boolean, value: unknown): void {
    this.set(path, on ? value : undefined);
  }

  protected toggleFilterSuit(suit: string, on: boolean): void {
    const current = this.v().filterSuits ?? [];
    this.set(['setup', 'filter'], { suits: on ? [...current, suit] : current.filter((s) => s !== suit) });
  }

  protected requirements(action: 'play' | 'pass'): Requirement[] {
    return (getPath(this.store.draft().game, ['actions', action, 'require']) as Requirement[] | undefined) ?? [];
  }

  protected setRequirement(action: 'play' | 'pass', i: number, patch: Partial<Requirement>): void {
    const list = this.requirements(action).map((r, j) => (j === i ? { ...r, ...patch } : r));
    this.set(['actions', action, 'require'], list);
  }

  protected addRequirement(action: 'play' | 'pass'): void {
    this.set(['actions', action, 'require'], [...this.requirements(action), { when: { match: ['intent.card', 'table.last'], on: 'suit' }, reason: 'no-match' }]);
  }

  protected removeRequirement(action: 'play' | 'pass', i: number): void {
    const list = this.requirements(action).filter((_, j) => j !== i);
    this.set(['actions', action, 'require'], list.length ? list : undefined);
  }

  protected toggleAction(action: 'play' | 'pass', on: boolean): void {
    const actions = { ...((getPath(this.store.draft().game, ['actions']) as Record<string, unknown> | undefined) ?? {}) };
    if (on) actions[action] = { steps: [] };
    else delete actions[action];
    this.set(['actions'], Object.keys(actions).length ? actions : undefined);
  }

  protected timingIntents(): string[] {
    return (getPath(this.store.draft().game, ['timing', 'intents']) as string[] | undefined) ?? [];
  }

  protected toggleTimingIntent(intent: string, on: boolean): void {
    const list = on ? [...this.timingIntents(), intent] : this.timingIntents().filter((i) => i !== intent);
    this.set(['timing', 'intents'], list);
  }

  protected goToFirstProblem(): void {
    const [first] = this.store.validation().problems;
    if (!first) return;
    const el = 'uid' in first
      ? this.document.querySelector<HTMLElement>(`[data-block-uid="${first.uid}"]`)
      : this.document.querySelector<HTMLElement>(`[data-field="${first.field.split('.')[0]}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    (el?.querySelector<HTMLElement>('input, select, textarea, button') ?? el)?.focus({ preventScroll: true });
  }

  protected async save(): Promise<void> {
    if (!this.store.validation().game) {
      this.snack.open(`Fix ${this.problemCount()} ${this.problemCount() === 1 ? 'problem' : 'problems'} before saving.`, 'Show', { duration: 5000 })
        .onAction().subscribe(() => this.goToFirstProblem());
      this.goToFirstProblem();
      return;
    }
    try {
      const saved = await this.store.save();
      if (!saved) return;
      this.snack.open(`Saved “${saved.name}”`, undefined, { duration: 2500 });
      this.leaving = true;
      await this.router.navigate(['/games']);
    } catch (err) {
      this.snack.open(err instanceof Error ? err.message : 'Could not save the game.', 'OK', { duration: 6000 });
    }
  }
}
