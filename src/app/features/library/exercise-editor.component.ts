import { ChangeDetectionStrategy, Component, computed, effect, inject, input, resource, signal, untracked } from '@angular/core';
import { FormArray, FormControl, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
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
import { DeckRepository, ExerciseRepository } from '../../core/db/repositories';
import {
  BAND_ANCHORS,
  type BandAnchor, type Difficulty, type Equipment, type Exercise, type ExerciseCategory, type Measure, type MuscleGroup,
} from '../../domain/models/schemas';
import { CATEGORY_LABEL, DIFFICULTY_LABEL, EQUIPMENT_LABEL, MEASURE_LABEL, MUSCLE_LABEL, keysOf } from '../../shared/labels';
import { ExerciseFigureComponent } from '../../shared/ui/exercise-figure/exercise-figure.component';
import type { HasUnsavedChanges } from '../../shared/unsaved-changes.guard';
import {
  DEFAULT_PROP, PROP_LABEL, PROP_TYPES, blankExerciseForm, poseLabel, toExercise, toFormValue, toProp, withPropEquipment,
  type ExerciseFormValue, type PropType,
} from './exercise-form.model';
import { PosePickerDialog, type PosePickerData } from './pose-picker.dialog';

const BAND_ANCHOR_LABEL: Record<BandAnchor, string> = {
  feet: 'Under the feet', front: 'In front', behind: 'Behind', above: 'Overhead', knees: 'Around the knees', hands: 'Between the hands',
};

/** /library/new and /library/:exerciseId/edit — user-made exercises (§3 phase 3). */
@Component({
  selector: 'df-exercise-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule, RouterLink, MatButtonModule, MatChipsModule, MatFormFieldModule, MatIconModule, MatInputModule,
    MatRadioModule, MatSelectModule, MatSlideToggleModule, ExerciseFigureComponent,
  ],
  templateUrl: './exercise-editor.component.html',
  styleUrl: './exercise-editor.component.scss',
})
export class ExerciseEditorComponent implements HasUnsavedChanges {
  /** Route param on /library/:exerciseId/edit. */
  readonly exerciseId = input<string>();
  /** Query param on /library/new: start as a copy of this exercise. */
  readonly from = input<string>();

  private readonly fb = inject(NonNullableFormBuilder);
  private readonly repo = inject(ExerciseRepository);
  private readonly decks = inject(DeckRepository);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);

  protected readonly categories = keysOf(CATEGORY_LABEL);
  protected readonly muscles = keysOf(MUSCLE_LABEL);
  protected readonly equipmentKeys = keysOf(EQUIPMENT_LABEL);
  protected readonly measures = keysOf(MEASURE_LABEL);
  protected readonly difficulties: Difficulty[] = [1, 2, 3, 4, 5];
  protected readonly propTypes = PROP_TYPES;
  protected readonly propLabel = PROP_LABEL;
  protected readonly bandAnchors = BAND_ANCHORS;
  protected readonly bandAnchorLabel = BAND_ANCHOR_LABEL;
  protected readonly categoryLabel = CATEGORY_LABEL;
  protected readonly muscleLabel = MUSCLE_LABEL;
  protected readonly equipmentLabel = EQUIPMENT_LABEL;
  protected readonly measureLabel = MEASURE_LABEL;
  protected readonly difficultyLabel = DIFFICULTY_LABEL;
  protected readonly poseName = poseLabel;

  protected readonly busy = signal(false);
  protected readonly source = signal<Exercise | null>(null);
  protected readonly isCopy = signal(false);
  private saved = false;

  protected readonly cues = new FormArray<FormControl<string>>([]);
  protected readonly form = this.fb.group({
    name: this.fb.control('', [Validators.required, Validators.maxLength(60)]),
    description: this.fb.control('', Validators.maxLength(280)),
    cues: this.cues,
    category: this.fb.control<ExerciseCategory>('bodyweight'),
    muscleGroups: this.fb.control<MuscleGroup[]>([], Validators.required),
    equipment: this.fb.control<Equipment[]>(['none'], Validators.required),
    difficulty: this.fb.control<Difficulty>(2),
    measure: this.fb.control<Measure>('reps'),
    start: this.fb.control('stand'),
    end: this.fb.control('squat'),
    prop: this.fb.group({
      type: this.fb.control<PropType>('none'),
      anchor: this.fb.control<BandAnchor>('feet'),
      x: this.fb.control(DEFAULT_PROP.x, [Validators.min(0), Validators.max(100)]),
      y: this.fb.control(DEFAULT_PROP.y, [Validators.min(0), Validators.max(100)]),
      r: this.fb.control(DEFAULT_PROP.r, [Validators.min(2), Validators.max(40)]),
      attach: this.fb.control<'hands' | 'feet'>('hands'),
      anchorX: new FormControl<number | null>(50),
    }),
    seated: this.fb.control(false),
    lowImpact: this.fb.control(false),
    notes: this.fb.control('', Validators.maxLength(140)),
  });

  private readonly value = toSignal(this.form.valueChanges.pipe(startWith(null), map(() => this.form.getRawValue() as ExerciseFormValue)), {
    requireSync: true,
  });

  protected readonly figure = computed(() => {
    const v = this.value();
    return { start: v.start, end: v.end, prop: toProp(v.prop) };
  });
  protected readonly propType = computed(() => this.value().prop.type);
  protected readonly editing = computed(() => !!this.source() && !this.isCopy());

  protected readonly loaded = resource({
    params: () => ({ id: this.exerciseId(), from: this.from() }),
    loader: async ({ params }) => {
      const id = params.id ?? params.from;
      return id ? ((await this.repo.get(id)) ?? null) : null;
    },
  });

  constructor() {
    effect(() => {
      const found = this.loaded.value();
      if (found === undefined) return;
      untracked(() => this.init(found));
    });
  }

  hasUnsavedChanges(): boolean {
    return this.form.dirty && !this.saved;
  }

  protected addCue(value = ''): void {
    this.cues.push(this.fb.control(value, Validators.maxLength(80)));
    this.form.markAsDirty();
  }

  protected removeCue(i: number): void {
    this.cues.removeAt(i);
    this.form.markAsDirty();
  }

  /** Keeps the equipment chips honest when the drawn prop changes. */
  protected onPropType(type: PropType): void {
    this.form.controls.equipment.setValue(withPropEquipment(this.form.controls.equipment.value, type));
  }

  protected async pickPose(which: 'start' | 'end'): Promise<void> {
    const control = which === 'start' ? this.form.controls.start : this.form.controls.end;
    const data: PosePickerData = { which, selected: control.value, prop: toProp(this.value().prop) };
    const picked = await firstValueFrom(this.dialog.open(PosePickerDialog, { data, width: '900px', maxWidth: '96vw' }).afterClosed());
    if (picked) {
      control.setValue(picked);
      this.form.markAsDirty();
    }
  }

  protected swapPoses(): void {
    const { start, end } = this.form.controls;
    const [a, b] = [start.value, end.value];
    start.setValue(b);
    end.setValue(a);
    this.form.markAsDirty();
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    try {
      const id = this.editing() ? this.source()!.id : newId('exercise');
      const exercise = toExercise(this.form.getRawValue() as ExerciseFormValue, id);
      await this.repo.save(exercise);
      this.saved = true;
      this.snack.open(`Saved “${exercise.name}”`, undefined, { duration: 2500 });
      await this.router.navigate(['/library', exercise.id]);
    } catch (err) {
      this.saved = false;
      this.snack.open(err instanceof Error ? err.message : 'Could not save the exercise.', 'OK', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const exercise = this.source();
    if (!exercise || this.isCopy()) return;
    const decks = (await this.decks.usingExercise(exercise.id)).filter((d) => !d.builtIn);
    if (decks.length && !window.confirm(`${decks.length} of your ${decks.length === 1 ? 'deck uses' : 'decks use'} “${exercise.name}”. Delete it anyway?`)) return;
    await this.repo.delete(exercise.id);
    this.saved = true;
    await this.router.navigate(['/library']);
    const ref = this.snack.open(`Deleted “${exercise.name}”`, 'Undo', { duration: 6000 });
    if ((await firstValueFrom(ref.afterDismissed())).dismissedByAction) await this.repo.save(exercise);
  }

  private init(found: Exercise | null): void {
    const copy = !!this.from() || (!!found && found.builtIn);
    this.source.set(found);
    this.isCopy.set(copy);
    const value = found ? toFormValue(found) : blankExerciseForm();
    if (copy && found) value.name = `${found.name} (copy)`;
    this.cues.clear();
    for (const cue of value.cues) this.addCue(cue);
    this.form.patchValue(value);
    this.form.markAsPristine();
  }
}
