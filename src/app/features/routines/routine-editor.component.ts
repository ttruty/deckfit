import { ChangeDetectionStrategy, Component, computed, effect, inject, input, resource, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormRecord, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom, map, startWith } from 'rxjs';
import { newId } from '../../core/db/deckfit-db';
import { DeckRepository, ExerciseRepository, GameRepository, RoutineRepository } from '../../core/db/repositories';
import { applyDeckFilters } from '../../domain/models/deck-rules';
import type { GameDefinition, SettingDef } from '../../domain/models/game.schema';
import { INTENSITIES, SUITS, type Difficulty, type Equipment, type Intensity, type JokerRule, type Suit } from '../../domain/models/schemas';
import { workScale } from '../../domain/engine/amounts';
import { DIFFICULTY_LABEL, EQUIPMENT_LABEL, INTENSITY_HELP, INTENSITY_LABEL, SUIT_NAME, SUIT_SYMBOL, keysOf } from '../../shared/labels';
import { LaunchError, SessionLauncher } from '../play/session-launcher.service';
import { REP_MULTIPLIERS, gameSettingValues, toDeckFilters, toFormValue, toRoutine, type RoutineFormValue, type SettingValue } from './routine-form.model';

const JOKER_RULES: { value: JokerRule; label: string; help: string }[] = [
  { value: 'rest', label: 'Rest', help: '30 seconds of rest' },
  { value: 'skip', label: 'Skip', help: 'Jokers do nothing' },
  { value: 'wild', label: 'Wild', help: 'Pick any exercise, face-card amount' },
  { value: 'bonus-cardio', label: 'Bonus cardio', help: '60 seconds of cardio' },
];

@Component({
  selector: 'df-routine-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule, RouterLink, MatButtonModule, MatChipsModule, MatFormFieldModule, MatIconModule, MatInputModule,
    MatRadioModule, MatSelectModule, MatSlideToggleModule,
  ],
  templateUrl: './routine-editor.component.html',
  styleUrl: './routine-editor.component.scss',
})
export class RoutineEditorComponent {
  /** Route param; absent for /routines/new. */
  readonly id = input<string>();

  private readonly fb = inject(NonNullableFormBuilder);
  private readonly routines = inject(RoutineRepository);
  private readonly decksRepo = inject(DeckRepository);
  private readonly gamesRepo = inject(GameRepository);
  private readonly exercisesRepo = inject(ExerciseRepository);
  private readonly launcher = inject(SessionLauncher);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);

  protected readonly data = resource({
    params: () => ({ id: this.id() }),
    loader: async ({ params }) => {
      const [decks, games, exercises, routine] = await Promise.all([
        this.decksRepo.list(), this.gamesRepo.list(), this.exercisesRepo.list(),
        params.id ? this.routines.get(params.id) : Promise.resolve(undefined),
      ]);
      return {
        decks: decks.sort((a, b) => Number(a.builtIn) - Number(b.builtIn) || a.name.localeCompare(b.name)),
        games: games.sort((a, b) => a.name.localeCompare(b.name)),
        exercisesById: new Map(exercises.map((e) => [e.id, e])),
        routine,
      };
    },
  });

  protected readonly ready = signal(false);
  protected readonly busy = signal(false);
  private saved = false;

  /** Game-specific controls, rebuilt from the selected game's settingsSchema. */
  private readonly gameRecord = new FormRecord<FormControl<SettingValue>>({});

  protected readonly form = this.fb.group({
    name: this.fb.control('', [Validators.maxLength(60)]),
    deckId: this.fb.control('', Validators.required),
    gameId: this.fb.control('', Validators.required),
    favorite: this.fb.control(false),
    core: this.fb.group({
      intensity: this.fb.control<Intensity>('moderate'),
      repMultiplier: this.fb.control(1),
      faceCardValue: this.fb.control(10, [Validators.required, Validators.min(0), Validators.max(50)]),
      aceValue: this.fb.control(11, [Validators.required, Validators.min(0), Validators.max(50)]),
      jokerRule: this.fb.control<JokerRule>('rest'),
      maxRepCap: new FormControl<number | null>(null, [Validators.min(1), Validators.max(999)]),
    }),
    game: this.gameRecord,
    filters: this.fb.group({
      suits: this.fb.control<Suit[]>([...SUITS], Validators.required),
      maxDifficulty: new FormControl<Difficulty | null>(null),
      limitEquipment: this.fb.control(false),
      equipment: this.fb.control<Equipment[]>([]),
    }),
  });

  private readonly value = toSignal(this.form.valueChanges.pipe(startWith(null), map(() => this.form.getRawValue() as RoutineFormValue)), {
    requireSync: true,
  });

  protected readonly selectedGame = computed(() => this.data.value()?.games.find((g) => g.id === this.value().gameId));
  protected readonly selectedDeck = computed(() => this.data.value()?.decks.find((d) => d.id === this.value().deckId));
  protected readonly suggestedName = computed(() => {
    const [deck, game] = [this.selectedDeck(), this.selectedGame()];
    return deck && game ? `${deck.name.replace(/ deck$/i, '')} · ${game.name}` : 'My routine';
  });
  protected readonly cardsInPlay = computed(() => {
    const deck = this.selectedDeck();
    const data = this.data.value();
    if (!deck || !data) return null;
    const cards = applyDeckFilters(deck.cards, data.exercisesById, toDeckFilters(this.value().filters));
    return { total: cards.length, exercises: cards.filter((c) => c.exerciseId).length };
  });
  protected readonly gameSettings = computed(() => {
    const game = this.selectedGame();
    return game ? Object.entries(game.settingsSchema).map(([key, def]) => ({ key, def, label: def.label ?? key })) : [];
  });

  protected readonly multipliers = REP_MULTIPLIERS;
  protected readonly jokerRules = JOKER_RULES;
  protected readonly intensities = INTENSITIES;
  protected readonly intensityLabel = INTENSITY_LABEL;
  protected readonly intensityHelp = INTENSITY_HELP;
  /** What the settings do to a card's amount, in words: "a 10-rep card asks for 14". */
  protected readonly workExample = computed(() => {
    const core = this.value().core;
    const scale = workScale({ intensity: core.intensity, repMultiplier: core.repMultiplier });
    return `A 10-rep card asks for ${Math.round(10 * scale)}, a 30-second hold lasts ${Math.round(30 * scale)}s.`;
  });
  protected readonly suits = SUITS;
  protected readonly suitSymbol = SUIT_SYMBOL;
  protected readonly suitName = SUIT_NAME;
  protected readonly equipmentKeys = keysOf(EQUIPMENT_LABEL);
  protected readonly equipmentLabel = EQUIPMENT_LABEL;
  protected readonly difficulties: Difficulty[] = [1, 2, 3, 4, 5];
  protected readonly difficultyLabel = DIFFICULTY_LABEL;

  constructor() {
    effect(() => {
      const data = this.data.value();
      if (!data) return;
      untracked(() => this.initForm(data));
    });
    this.form.controls.gameId.valueChanges.pipe(takeUntilDestroyed()).subscribe((gameId) => {
      const game = this.data.value()?.games.find((g) => g.id === gameId);
      if (game) this.rebuildGameControls(game, this.gameRecord.getRawValue());
    });
  }

  hasUnsavedChanges(): boolean {
    return this.form.dirty && !this.saved;
  }

  protected isEditing(): boolean {
    return !!this.data.value()?.routine;
  }

  protected optionLabel(option: string): string {
    return option.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  }

  protected numberDef(def: SettingDef): Extract<SettingDef, { type: 'number' }> {
    return def as Extract<SettingDef, { type: 'number' }>;
  }

  protected enumDef(def: SettingDef): Extract<SettingDef, { type: 'enum' }> {
    return def as Extract<SettingDef, { type: 'enum' }>;
  }

  protected async save(start: boolean): Promise<void> {
    const data = this.data.value();
    const game = this.selectedGame();
    if (!data || !game || this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue() as RoutineFormValue;
    if (!value.name.trim()) value.name = this.suggestedName();

    this.busy.set(true);
    try {
      const routine = toRoutine(value, game, data.routine?.id ?? newId('routine'));
      await this.routines.save(routine);
      this.saved = true;
      if (start) {
        const sessionId = await this.launcher.startRoutine(routine);
        await this.router.navigate(['/play', sessionId]);
      } else {
        this.snack.open(`Saved “${routine.name}”`, undefined, { duration: 2500 });
        await this.router.navigate(['/']);
      }
    } catch (err) {
      this.saved = false;
      const message = err instanceof LaunchError ? err.message : err instanceof Error ? err.message : 'Could not save.';
      this.snack.open(message, 'OK', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const routine = this.data.value()?.routine;
    if (!routine) return;
    await this.routines.delete(routine.id);
    this.saved = true;
    await this.router.navigate(['/']);
    const ref = this.snack.open(`Deleted “${routine.name}”`, 'Undo', { duration: 6000 });
    if ((await firstValueFrom(ref.afterDismissed())).dismissedByAction) await this.routines.save(routine);
  }

  private initForm(data: NonNullable<ReturnType<typeof this.data.value>>): void {
    const game = data.games.find((g) => g.id === data.routine?.gameId) ?? data.games.find((g) => g.id === 'solo-deal') ?? data.games[0];
    if (!game) return;
    const fallbackDeck = data.decks.find((d) => d.id === 'deck-bodyweight')?.id ?? data.decks[0]?.id ?? '';
    const value = toFormValue(data.routine, game, fallbackDeck);
    this.rebuildGameControls(game, value.game);
    this.form.setValue(value, { emitEvent: true });
    this.form.markAsPristine();
    this.ready.set(true);
  }

  private rebuildGameControls(game: GameDefinition, current: Record<string, unknown>): void {
    const record = this.gameRecord;
    const values = gameSettingValues(game, current);
    for (const key of Object.keys(record.controls)) record.removeControl(key, { emitEvent: false });
    for (const [key, def] of Object.entries(game.settingsSchema)) {
      const validators = def.type === 'number'
        ? [Validators.min(def.min), Validators.max(def.max), ...(def.default === null ? [] : [Validators.required])]
        : def.type === 'suits' ? [Validators.required] : [];
      record.addControl(key, new FormControl<SettingValue>(values[key], validators), { emitEvent: false });
    }
    record.updateValueAndValidity();
  }
}
