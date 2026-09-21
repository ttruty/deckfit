import { ChangeDetectionStrategy, Component, computed, inject, resource, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { DeckRepository, GameRepository, RoutineRepository } from '../../core/db/repositories';
import { normalizeRoomCode } from '../../core/sync/room-code';
import { REALTIME_CONFIGURED } from '../../core/sync/realtime-config';
import { INTENSITIES, type Intensity, type Routine } from '../../domain/models/schemas';
import { INTENSITY_HELP, INTENSITY_LABEL } from '../../shared/labels';
import { PreferencesService } from '../../core/settings/preferences.service';
import { LaunchError, QUICK_START, SessionLauncher } from '../play/session-launcher.service';
import { InstallBannerComponent } from './install-banner.component';

@Component({
  selector: 'df-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, InstallBannerComponent],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent {
  private readonly routinesRepo = inject(RoutineRepository);
  private readonly decks = inject(DeckRepository);
  private readonly games = inject(GameRepository);
  private readonly launcher = inject(SessionLauncher);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  /** False when no realtime backend is configured: rooms then live in this browser only. */
  protected readonly realtime = inject(REALTIME_CONFIGURED);
  private readonly prefs = inject(PreferencesService);

  /** Quick Start has no routine, so it works at the device's intensity (§6.1). */
  protected readonly intensity = this.prefs.intensity;
  protected readonly intensities = INTENSITIES;
  protected readonly intensityLabel = INTENSITY_LABEL;
  protected readonly intensityHelp = INTENSITY_HELP;

  protected readonly data = resource({
    loader: async () => {
      const [routines, decks, games] = await Promise.all([this.routinesRepo.list(), this.decks.list(), this.games.list()]);
      const deckName = new Map(decks.map((d) => [d.id, d.name]));
      const gameName = new Map(games.map((g) => [g.id, g.name]));
      const view = (r: Routine) => ({
        routine: r,
        subtitle: [
          deckName.get(r.deckId) ?? 'Missing deck',
          gameName.get(r.gameId) ?? 'Missing game',
          ...(r.settings.intensity && r.settings.intensity !== 'moderate' ? [`${INTENSITY_LABEL[r.settings.intensity]} intensity`] : []),
          ...(r.settings.repMultiplier === 1 ? [] : [`×${r.settings.repMultiplier}`]),
        ].join(' · '),
        playable: deckName.has(r.deckId) && gameName.has(r.gameId),
      });
      return {
        favorites: routines.filter((r) => r.favorite).map(view),
        others: routines.filter((r) => !r.favorite).map(view),
        quickStart: `${deckName.get(QUICK_START.deckId) ?? 'Bodyweight deck'} · ${gameName.get(QUICK_START.gameId) ?? 'Solo Deal'}`,
      };
    },
  });

  /** Id of whatever is being launched, to disable its button and show progress. */
  protected readonly starting = signal<string | null>(null);
  protected readonly hasRoutines = computed(() => {
    const d = this.data.value();
    return !!d && d.favorites.length + d.others.length > 0;
  });

  protected readonly roomCode = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, (c) => (normalizeRoomCode(c.value) ? null : { code: true })],
  });
  /** A FormGroup so (ngSubmit) fires and the native submit is prevented. */
  protected readonly joinForm = new FormGroup({ code: this.roomCode });

  protected setIntensity(intensity: Intensity): void {
    this.prefs.intensity.set(intensity);
  }

  protected quickStart(): Promise<void> {
    return this.launch('quick', () => this.launcher.start({ ...QUICK_START, settings: { intensity: this.intensity() } }));
  }

  protected startRoutine(routine: Routine): Promise<void> {
    return this.launch(routine.id, () => this.launcher.startRoutine(routine));
  }

  protected joinRoom(): void {
    const code = normalizeRoomCode(this.roomCode.value);
    if (!code) {
      this.roomCode.markAsTouched();
      return;
    }
    void this.router.navigate(['/room', code]);
  }

  private async launch(key: string, start: () => Promise<string>): Promise<void> {
    if (this.starting()) return;
    this.starting.set(key);
    try {
      const sessionId = await start();
      await this.router.navigate(['/play', sessionId]);
    } catch (err) {
      this.snack.open(err instanceof LaunchError ? err.message : 'Could not start the workout.', 'OK', { duration: 6000 });
    } finally {
      this.starting.set(null);
    }
  }
}
