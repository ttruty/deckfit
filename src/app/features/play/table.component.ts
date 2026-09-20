import { ChangeDetectionStrategy, Component, effect, inject, input, linkedSignal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { AudioCueService } from '../../core/audio/audio-cue.service';
import { WakeLockService } from '../../core/wake-lock/wake-lock.service';
import { CardFaceComponent } from '../../shared/ui/card-face/card-face.component';
import { ExerciseFigureComponent } from '../../shared/ui/exercise-figure/exercise-figure.component';
import { WildPickerComponent } from './wild-picker.component';
import { StepperComponent } from '../../shared/ui/stepper/stepper.component';
import { TimerRingComponent } from '../../shared/ui/timer-ring/timer-ring.component';
import { DrawPileComponent } from './draw-pile.component';
import { PlayStore } from './play.store';
import { WorkoutSummaryComponent } from './workout-summary.component';
import { GameRepository } from '../../core/db/repositories';
import { HowToPlayDialog, type HowToPlayData } from '../../shared/ui/how-to-play/how-to-play.dialog';
import { MatDialog } from '@angular/material/dialog';

@Component({
  selector: 'df-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [PlayStore],
  imports: [
    RouterLink, MatButtonModule, MatIconModule, MatTooltipModule,
    CardFaceComponent, ExerciseFigureComponent, StepperComponent, TimerRingComponent, WorkoutSummaryComponent, DrawPileComponent,
    WildPickerComponent,
  ],
  templateUrl: './table.component.html',
  styleUrl: './table.component.scss',
})
export class TableComponent {
  /** Route param. */
  readonly sessionId = input.required<string>();

  protected readonly store = inject(PlayStore);
  protected readonly audio = inject(AudioCueService);
  protected readonly wakeLock = inject(WakeLockService);

  /** Reps actually done; resets to the task amount whenever the task changes. */
  private readonly dialog = inject(MatDialog);
  private readonly games = inject(GameRepository);

  protected readonly reps = linkedSignal(() => this.store.currentTask()?.task.amount ?? 0);

  constructor() {
    effect(() => {
      const id = this.sessionId();
      untracked(() => void this.store.load(id));
    });
  }

  /** The game's rules, without leaving the workout. */
  protected async showRules(): Promise<void> {
    const session = this.store.session();
    const game = session ? await this.games.get(session.game.id) : undefined;
    if (!session) return;
    const settings = session.settings;
    const data: HowToPlayData = {
      name: session.game.name,
      summary: game?.summary ?? '',
      steps: game?.howTo ?? [],
      facts: [
        session.deck.name,
        ...(settings.repMultiplier === 1 ? [] : [`×${settings.repMultiplier} reps`]),
        ...(settings.maxRepCap ? [`max ${settings.maxRepCap} per task`] : []),
        `jokers: ${settings.jokerRule}`,
      ],
    };
    this.dialog.open(HowToPlayDialog, { data, maxWidth: '520px' });
  }

  protected done(): void {
    const current = this.store.currentTask();
    if (!current) return;
    this.store.complete(current.task.measure === 'reps' ? this.reps() : undefined);
  }

  protected async end(): Promise<void> {
    if (!window.confirm('End this workout? Your progress so far is saved.')) return;
    await this.store.abandon();
  }

  protected toggleBeeps(): void {
    this.audio.unlock();
    this.audio.beeps.update((v) => !v);
  }

  protected toggleSpeech(): void {
    this.audio.speech.update((v) => !v);
  }
}
