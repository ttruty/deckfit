import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, resource, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { ChallengeService, type MyChallenge } from '../../core/challenges/challenge.service';
import { DeckRepository, GameRepository, RoutineRepository } from '../../core/db/repositories';
import { HistoryService } from '../../core/history/history.service';
import { normalizeRoomCode } from '../../core/sync/room-code';
import { REALTIME_CONFIGURED } from '../../core/sync/realtime-config';
import { goalText } from '../../domain/models/challenge.schema';
import type { Routine } from '../../domain/models/schemas';
import { INTENSITY_LABEL } from '../../shared/labels';
import { DfIconComponent } from '../../shared/ui/icon/df-icon.component';
import { LaunchError, SessionLauncher } from '../play/session-launcher.service';
import { InstallBannerComponent } from './install-banner.component';
import { QuickStartComponent } from './quick-start.component';

/** Home (§9f): today's line, Quick start, challenges, routines, rooms, install. */
@Component({
  selector: 'df-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, ReactiveFormsModule, RouterLink, DfIconComponent, InstallBannerComponent, QuickStartComponent],
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
  private readonly history = inject(HistoryService);
  private readonly challengeService = inject(ChallengeService);
  /** False when no realtime backend is configured: rooms then live in this browser only. */
  protected readonly realtime = inject(REALTIME_CONFIGURED);

  /** The one line under "Today": streak and the week's reps (§9e). */
  protected readonly headline = resource({
    loader: () => this.history.headline().catch(() => ({ streak: 0, repsThisWeek: 0, workouts: 0 })),
  }).value;

  protected readonly data = resource({
    loader: async () => {
      const [routines, decks, games] = await Promise.all([this.routinesRepo.list(), this.decks.list(), this.games.list()]);
      const deckName = new Map(decks.map((d) => [d.id, d.name]));
      const gameById = new Map(games.map((g) => [g.id, g]));
      const view = (r: Routine) => {
        const game = gameById.get(r.gameId);
        return {
          routine: r,
          subtitle: [
            deckName.get(r.deckId) ?? 'Missing deck',
            game?.name ?? 'Missing game',
            INTENSITY_LABEL[r.settings.intensity ?? 'moderate'],
            ...(game && game.players.max >= 2 ? [`room for ${game.players.min}–${game.players.max}`] : []),
          ].join(' · '),
          playable: deckName.has(r.deckId) && !!game,
          multiplayer: !!game && game.players.max >= 2,
        };
      };
      return {
        favorites: routines.filter((r) => r.favorite).map(view),
        others: routines.filter((r) => !r.favorite).map(view),
      };
    },
  });

  /**
   * Challenges you're in (§7b), in their own resource: they need the network, and Home must not
   * wait on it — if it fails there's simply nothing to show here.
   */
  protected readonly challenges = resource({
    loader: async () => {
      try {
        return await this.challengeService.myChallenges();
      } catch {
        return [] as MyChallenge[];
      }
    },
  });

  /** Id of whatever is being launched, to disable its button and show progress. */
  protected readonly starting = signal<string | null>(null);

  protected readonly roomCode = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, (c) => (normalizeRoomCode(c.value) ? null : { code: true })],
  });
  /** A FormGroup so (ngSubmit) fires and the native submit is prevented. */
  protected readonly joinForm = new FormGroup({ code: this.roomCode });

  /** One line per challenge: what it wants of you today, or what it cost you. */
  protected line(item: MyChallenge): string {
    const { status, challenge } = item;
    if (status.upcoming) return `Starts ${challenge.startsOn.slice(8)} ${monthOf(challenge.startsOn)} · ${goalText(challenge.goal)}`;
    if (status.over) return status.staked ? `Finished · ${status.staked} reps of yours in the pot` : 'Finished · you stayed clean';
    const day = `Day ${status.dayIndex} of ${status.totalDays}`;
    if (status.todayDone) {
      return `Done today · ${status.daysLeft - 1} ${status.daysLeft - 1 === 1 ? 'day' : 'days'} to go`;
    }
    return status.todayShort ? `${day} · ${status.todayShort} points to go today` : `${day} · ${challenge.ante} reps on the line`;
  }

  /** How much of the challenge is behind you, for the bar. */
  protected progress(item: MyChallenge): number {
    const { dayIndex, totalDays } = item.status;
    return totalDays ? Math.round(((dayIndex - 1) / totalDays) * 100) : 0;
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "03" → "Mar", for the one date Home shows. */
function monthOf(day: string): string {
  return MONTHS[Number(day.slice(5, 7)) - 1] ?? '';
}
