import { ChangeDetectionStrategy, Component, computed, inject, resource, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DeckRepository, ExerciseRepository, GameRepository, MetaRepository } from '../../core/db/repositories';
import { PreferencesService } from '../../core/settings/preferences.service';
import { buildDeck, deckExerciseIds } from '../../domain/models/deck-rules';
import { INTENSITIES, type Intensity } from '../../domain/models/schemas';
import { INTENSITY_HELP, INTENSITY_LABEL, EQUIPMENT_LABEL } from '../../shared/labels';
import { CardFaceMiniComponent } from '../../shared/ui/card-face/card-face-mini.component';
import { DeckLengthPickerComponent, cardCountFilter } from '../../shared/ui/deck-length/deck-length-picker.component';
import { toCardFaceModel } from '../../shared/ui/card-face/card-face-model';
import { DfIconComponent } from '../../shared/ui/icon/df-icon.component';
import { SegmentedComponent } from '../../shared/ui/segmented/segmented.component';
import { LaunchError, QUICK_START, SessionLauncher } from '../play/session-launcher.service';
import { QuickPickerDialog, type QuickPickData } from './quick-picker.dialog';

/**
 * Quick start (§9f): the deck, the game and the intensity, then one big button. The deck and
 * game are remembered on the device (`meta.quickStartDeckId` / `quickStartGameId`), so the
 * fastest path stays the one you last used rather than a constant.
 */
@Component({
  selector: 'df-quick-start',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CardFaceMiniComponent, DeckLengthPickerComponent, DfIconComponent, SegmentedComponent],
  templateUrl: './quick-start.component.html',
  styleUrl: './quick-start.component.scss',
})
export class QuickStartComponent {
  private readonly decks = inject(DeckRepository);
  private readonly exercises = inject(ExerciseRepository);
  private readonly games = inject(GameRepository);
  private readonly meta = inject(MetaRepository);
  private readonly launcher = inject(SessionLauncher);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  private readonly prefs = inject(PreferencesService);

  protected readonly intensity = this.prefs.intensity;
  /** How long the workout is, in cards (§9g); remembered on the device like the intensity. */
  protected readonly deckLength = this.prefs.deckLength;
  protected readonly intensityOptions = INTENSITIES.map((value) => ({ value, label: INTENSITY_LABEL[value] }));
  protected readonly intensityHelp = computed(() => INTENSITY_HELP[this.intensity()]);
  protected readonly starting = signal(false);

  /** The chosen deck and game, the lines that describe them, and the card to show beside them. */
  protected readonly data = resource({
    loader: async () => {
      const [decks, games, exercises, deckId, gameId] = await Promise.all([
        this.decks.list(),
        this.games.list(),
        this.exercises.list(),
        this.meta.get('quickStartDeckId'),
        this.meta.get('quickStartGameId'),
      ]);
      const deck = decks.find((d) => d.id === deckId) ?? decks.find((d) => d.id === QUICK_START.deckId) ?? decks[0];
      const game = games.find((g) => g.id === gameId) ?? games.find((g) => g.id === QUICK_START.gameId) ?? games[0];
      if (!deck || !game) return null;

      const byId = new Map(exercises.map((e) => [e.id, e]));
      const used = new Set(
        deckExerciseIds(deck).flatMap((id) => byId.get(id)?.equipment ?? []).filter((e) => e !== 'none'),
      );
      // One card this deck could deal, so the hero shows the real thing rather than a constant.
      const dealt = buildDeck(deck, byId, Date.now() >>> 0);
      const card = dealt.find((c) => c.suit === 'hearts') ?? dealt.find((c) => c.exerciseId);
      const { min, max } = game.players;

      return {
        decks,
        games,
        deck,
        game,
        size: dealt.length,
        sample: card ? toCardFaceModel(card, deck, byId) : null,
        equipment: used.size ? [...used].map((e) => EQUIPMENT_LABEL[e].toLowerCase()).join(', ') : 'no equipment',
        gameMeta: `${min === max ? min + ' player' : min + '–' + max + ' players'} · ${lower(game.summary)}`,
      };
    },
  });

  /** The deck row's second line, which says how much of the deck the chosen length actually deals. */
  protected readonly deckMeta = computed(() => {
    const data = this.data.value();
    if (!data) return '';
    const size = data.size;
    const length = this.deckLength();
    const cards = length === null || length >= size ? `${size} cards` : `${length} of ${size} cards`;
    return `${cards} · ${data.equipment}`;
  });

  protected async pickDeck(): Promise<void> {
    const data = this.data.value();
    if (!data) return;
    const picked = await this.choose({
      title: 'Deck',
      selected: data.deck.id,
      options: data.decks.map((deck) => ({
        id: deck.id,
        name: deck.name,
        meta: `${deck.suits.reduce((n, s) => n + s.exerciseIds.length, 0)} exercises${deck.builtIn ? '' : ' · yours'}`,
      })),
    });
    if (picked) {
      await this.meta.set('quickStartDeckId', picked);
      this.data.reload();
    }
  }

  protected async pickGame(): Promise<void> {
    const data = this.data.value();
    if (!data) return;
    const picked = await this.choose({
      title: 'Game',
      selected: data.game.id,
      options: data.games.map((game) => ({
        id: game.id,
        name: game.name,
        meta: `${game.players.min === game.players.max ? game.players.min + ' player' : game.players.min + '–' + game.players.max + ' players'} · ${game.summary}`,
      })),
    });
    if (picked) {
      await this.meta.set('quickStartGameId', picked);
      this.data.reload();
    }
  }

  protected async start(): Promise<void> {
    const data = this.data.value();
    if (!data || this.starting()) return;
    this.starting.set(true);
    try {
      const id = await this.launcher.start({
        deckId: data.deck.id,
        gameId: data.game.id,
        settings: { intensity: this.intensity() },
        deckFilters: cardCountFilter(this.deckLength(), data.size),
      });
      await this.router.navigate(['/play', id]);
    } catch (err) {
      this.snack.open(err instanceof LaunchError ? err.message : 'Could not start the workout.', 'OK', { duration: 6000 });
    } finally {
      this.starting.set(false);
    }
  }

  private async choose(data: QuickPickData): Promise<string | undefined> {
    const ref = this.dialog.open(QuickPickerDialog, { data, maxWidth: '520px', width: '92vw' });
    return firstValueFrom(ref.afterClosed());
  }

  protected setIntensity(value: Intensity): void {
    this.prefs.intensity.set(value);
  }
}

/** "Flip one card at a time, do it." → "flip one card at a time, do it" */
function lower(summary: string): string {
  const text = summary.replace(/\.$/, '');
  return text.charAt(0).toLowerCase() + text.slice(1);
}
