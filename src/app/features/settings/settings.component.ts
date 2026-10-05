import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, resource, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { firstValueFrom } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AudioCueService } from '../../core/audio/audio-cue.service';
import { BundleImportError, BundleService } from '../../core/db/bundle.service';
import { DataEraseService } from '../../core/db/erase.service';
import { MetaRepository } from '../../core/db/repositories';
import { HabitsService } from '../../core/habits/habits.service';
import { IdentityService } from '../../core/identity/identity.service';
import { InstallService } from '../../core/pwa/install.service';
import { DisclaimerService } from '../../core/safety/disclaimer.service';
import { ThemeService, type ThemeMode } from '../../core/theme/theme.service';
import { PreferencesService } from '../../core/settings/preferences.service';
import { DECK_LENGTHS } from '../../domain/models/deck-rules';
import { INTENSITIES } from '../../domain/models/schemas';
import { INTENSITY_HELP, INTENSITY_LABEL } from '../../shared/labels';
import { TourService } from '../../core/tour/tour.service';
import { REALTIME_CONFIGURED } from '../../core/sync/realtime-config';
import { EraseDataDialog, type EraseData } from './erase-data.dialog';

/** /settings (§8): identity, look, sound, data export/import, and the safety notice. */
@Component({
  selector: 'df-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe, ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatRadioModule, MatSlideToggleModule,
  ],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent {
  private readonly identity = inject(IdentityService);
  private readonly bundles = inject(BundleService);
  private readonly meta = inject(MetaRepository);
  private readonly disclaimer = inject(DisclaimerService);
  private readonly tour = inject(TourService);
  private readonly snack = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly erase = inject(DataEraseService);
  /** False with no backend: a challenge then never left this browser, so an erase can't either. */
  private readonly shared = inject(REALTIME_CONFIGURED);
  protected readonly install = inject(InstallService);
  protected readonly theme = inject(ThemeService);
  protected readonly audio = inject(AudioCueService);
  protected readonly prefs = inject(PreferencesService);
  protected readonly habits = inject(HabitsService);
  protected readonly intensities = INTENSITIES;
  protected readonly intensityLabel = INTENSITY_LABEL;
  protected readonly intensityHelp = INTENSITY_HELP;
  /** Deck lengths (§9g): null first, since the whole deck is the default. */
  protected readonly deckLengths: { value: number | null; label: string; hint: string }[] = [
    { value: null, label: 'Whole deck', hint: '54 cards — the full workout' },
    ...DECK_LENGTHS.slice()
      .reverse()
      .map((n) => ({ value: n as number | null, label: `${n} cards`, hint: lengthHint(n) })),
  ];

  protected readonly name = new FormControl('', { nonNullable: true, validators: [Validators.maxLength(30)] });
  protected readonly busy = signal<'export' | 'import' | 'erase' | null>(null);
  protected readonly importProblems = signal<string[]>([]);
  protected readonly themes: { mode: ThemeMode; label: string; hint: string }[] = [
    { mode: 'system', label: 'Match my device', hint: 'Follows your light/dark setting' },
    { mode: 'light', label: 'Light', hint: 'Paper-coloured cards' },
    { mode: 'dark', label: 'Dark', hint: 'Easier in a dim room' },
  ];

  protected readonly info = resource({
    loader: async () => {
      const [me, contentVersion, acceptedAt, tourEnabled] = await Promise.all([
        this.identity.me(), this.meta.get('contentVersion'), this.disclaimer.acceptedAt(), this.tour.enabled(),
        this.habits.load(),
      ]);
      this.name.setValue(me.name === 'You' ? '' : me.name);
      this.tourEnabled.set(tourEnabled);
      return { me, contentVersion, acceptedAt };
    },
  });
  /** §16: one line on how reporting to Habits is going; empty when there's nothing to say. */
  protected habitsStatus(): string {
    switch (this.habits.status()) {
      case 'token': return 'Habits didn’t accept the token. Make a new one in Habits → Sources and paste it here.';
      case 'retrying': return 'Couldn’t reach Habits. Workouts wait here and are sent when it’s back.';
      case 'sending': return 'Sending…';
      case 'idle': return 'Up to date.';
      default: return '';
    }
  }

  /** Mirrors `tourEnabled` in `meta` so the toggle reflects what's stored. */
  protected readonly tourEnabled = signal(true);

  /** Only offered where the share sheet can actually take a file (phones, mostly). */
  protected readonly shareSupported = typeof navigator !== 'undefined' && !!navigator.canShare?.({
    files: [new File([''], 'x.json', { type: 'application/json' })],
  });
  protected readonly speechSupported = computed(() => this.audio.speechSupported);

  protected async saveName(): Promise<void> {
    if (this.name.invalid) return;
    await this.identity.rename(this.name.value);
    this.info.reload();
    this.snack.open('Name saved', undefined, { duration: 2000 });
  }

  /** Everything you've made as one JSON file: downloaded, or handed to the share sheet. */
  protected async exportData(share: boolean): Promise<void> {
    this.busy.set('export');
    try {
      const bundle = await this.bundles.exportBundle();
      const counts = `${bundle.decks.length} decks, ${bundle.games.length} games, ${bundle.exercises.length} exercises, ${bundle.routines.length} routines`;
      const file = new File([this.bundles.serialize(bundle)], `deckfit-${new Date().toISOString().slice(0, 10)}.json`, { type: 'application/json' });
      if (share) {
        await navigator.share({ files: [file], title: 'DeckFit backup' });
      } else {
        const url = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(url);
      }
      this.snack.open(`${share ? 'Shared' : 'Exported'} ${counts}`, undefined, { duration: 4000 });
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') this.snack.open('Could not export your data.', 'OK', { duration: 6000 });
    } finally {
      this.busy.set(null);
    }
  }

  protected async importFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.busy.set('import');
    this.importProblems.set([]);
    try {
      const result = await this.bundles.importBundle(await file.text());
      this.snack.open(`Imported ${result.added} new and replaced ${result.replaced} item${result.replaced === 1 ? '' : 's'}`, undefined, { duration: 4000 });
    } catch (err) {
      this.importProblems.set(err instanceof BundleImportError ? err.problems : [err instanceof Error ? err.message : 'Could not read that file.']);
    } finally {
      this.busy.set(null);
    }
  }

  /** §10: the workout log only. Decks, games and routines stay. */
  protected async clearHistory(): Promise<void> {
    if (!(await this.confirm('history'))) return;
    this.busy.set('erase');
    try {
      const gone = await this.erase.clearHistory();
      this.snack.open(gone ? `Cleared ${gone} workout${gone === 1 ? '' : 's'}` : 'There was no history to clear', undefined, { duration: 4000 });
    } finally {
      this.busy.set(null);
    }
  }

  /** §10: a factory reset — every table, the device's identity, its settings and its shared rows. */
  protected async eraseEverything(): Promise<void> {
    if (!(await this.confirm('all'))) return;
    this.busy.set('erase');
    try {
      const result = await this.erase.eraseEverything();
      this.info.reload();
      this.name.setValue('');
      this.tourEnabled.set(true);
      this.snack.open(
        result.challenges === 'kept'
          ? 'This device is erased. Your challenge rows couldn’t be reached — open a challenge while online to clear them.'
          : 'This device is erased. The built-in decks and games are back.',
        'OK',
        { duration: result.challenges === 'kept' ? 10000 : 5000 },
      );
    } catch {
      this.snack.open('Could not erase your data.', 'OK', { duration: 6000 });
    } finally {
      this.busy.set(null);
    }
  }

  private async confirm(scope: EraseData['scope']): Promise<boolean> {
    const data: EraseData = { scope, summary: await this.erase.summary(), shared: this.shared };
    const ref = this.dialog.open(EraseDataDialog, { data, maxWidth: '520px', width: '92vw' });
    return (await firstValueFrom(ref.afterClosed())) === true;
  }

  protected showDisclaimer(): void {
    void this.disclaimer.open(false);
  }

  /** §12a: replay the welcome guide, or stop it offering itself on a fresh launch. */
  protected async showGuide(): Promise<void> {
    await this.tour.open();
    this.tourEnabled.set(await this.tour.enabled());
  }

  protected async setGuideOnLaunch(enabled: boolean): Promise<void> {
    this.tourEnabled.set(enabled);
    await this.tour.setEnabled(enabled);
  }
}

/** Roughly what a length feels like, so the numbers aren't bare. */
function lengthHint(cards: number): string {
  return cards <= 12 ? 'A quick session' : cards <= 20 ? 'About a third of the deck' : 'Most of the deck';
}
