import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { Card, MuscleGroup, Suit } from '../../domain/models/schemas';
import { MUSCLE_LABEL, SUIT_NAME, SUIT_SYMBOL, keysOf } from '../../shared/labels';
import { CardFaceComponent } from '../../shared/ui/card-face/card-face.component';
import { DeckEditorStore } from './deck-editor.store';
import { ExercisePickerDialog, type ExercisePickerData, type ExercisePickerResult } from './exercise-picker.dialog';

type SuitForm = FormGroup<{ label: FormControl<string>; muscleGroups: FormControl<MuscleGroup[]> }>;

@Component({
  selector: 'df-deck-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DeckEditorStore],
  imports: [
    ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule,
    CardFaceComponent,
  ],
  templateUrl: './deck-editor.component.html',
  styleUrl: './deck-editor.component.scss',
})
export class DeckEditorComponent {
  /** Route param. */
  readonly deckId = input.required<string>();

  protected readonly store = inject(DeckEditorStore);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly muscles = keysOf(MUSCLE_LABEL);
  protected readonly muscleLabel = MUSCLE_LABEL;
  protected readonly suitSymbol = SUIT_SYMBOL;
  protected readonly suitName = SUIT_NAME;

  protected readonly form = this.fb.group({
    name: this.fb.control('', [Validators.required, Validators.maxLength(60)]),
    suits: this.fb.array<SuitForm>([]),
  });

  constructor() {
    effect(() => {
      const id = this.deckId();
      untracked(() => void this.store.load(id).then(() => this.resetForm()));
    });

    // Form → draft. Programmatic resets use emitEvent: false, so this only sees user edits.
    this.form.valueChanges.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(() => {
      const value = this.form.getRawValue();
      this.store.rename(value.name);
      this.store.deck()?.suits.forEach((s, i) => {
        const v = value.suits[i];
        if (v) this.store.setSuit(s.suit, { label: v.label, muscleGroups: v.muscleGroups });
      });
    });
  }

  /** For the unsaved-changes guard. */
  hasUnsavedChanges(): boolean {
    return this.store.dirty();
  }

  protected suitControls(): SuitForm[] {
    return this.form.controls.suits.controls;
  }

  protected async openPicker(card: Card): Promise<void> {
    const deck = this.store.deck();
    if (!deck || deck.builtIn || card.exerciseId === null) return;
    const mapping = deck.suits.find((s) => s.suit === card.suit);
    const data: ExercisePickerData = {
      card,
      suitLabel: mapping?.label ?? SUIT_NAME[card.suit],
      suitMuscleGroups: mapping?.muscleGroups ?? [],
      ...(deck.category ? { deckCategory: deck.category } : {}),
      exercises: this.store.exercises(),
    };
    const ref = this.dialog.open<ExercisePickerDialog, ExercisePickerData, ExercisePickerResult>(ExercisePickerDialog, {
      data, width: '560px', maxWidth: '95vw', autoFocus: 'first-tabbable',
    });
    const result = await firstValueFrom(ref.afterClosed());
    if (result) this.store.setCard(card.id, result.exerciseId, result.baseAmount);
  }

  protected autoFill(suit: Suit, label: string): void {
    const error = this.store.autoFill(suit);
    this.snack.open(error ?? `${label} filled by difficulty`, undefined, { duration: 3000 });
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    await this.store.save();
    this.snack.open('Deck saved', undefined, { duration: 2000 });
  }

  protected discard(): void {
    this.store.discard();
    this.resetForm();
  }

  protected async duplicate(): Promise<void> {
    const id = await this.store.duplicate();
    this.snack.open('Copy created — edit away', undefined, { duration: 3000 });
    await this.router.navigate(['/decks', id, 'edit']);
  }

  protected cardLabel(card: Card, label: string, exerciseName: string | undefined): string {
    const what = exerciseName ? `${exerciseName}, ${card.baseAmount}` : 'wild card';
    return `${card.rank === 'JOKER' ? 'Joker' : `${card.rank} of ${SUIT_NAME[card.suit]}`} (${label}): ${what}. Change exercise`;
  }

  private resetForm(): void {
    const deck = this.store.deck();
    if (!deck) return;
    this.form.controls.suits.clear({ emitEvent: false });
    for (const s of deck.suits) {
      this.form.controls.suits.push(
        this.fb.group({
          label: this.fb.control(s.label, [Validators.required, Validators.maxLength(24)]),
          muscleGroups: this.fb.control<MuscleGroup[]>(s.muscleGroups),
        }),
        { emitEvent: false },
      );
    }
    this.form.controls.name.setValue(deck.name, { emitEvent: false });
    if (deck.builtIn) this.form.disable({ emitEvent: false });
    else this.form.enable({ emitEvent: false });
    this.form.markAsPristine();
  }
}
