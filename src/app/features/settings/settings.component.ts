import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, resource, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AudioCueService } from '../../core/audio/audio-cue.service';
import { BundleImportError, BundleService } from '../../core/db/bundle.service';
import { MetaRepository } from '../../core/db/repositories';
import { IdentityService } from '../../core/identity/identity.service';
import { InstallService } from '../../core/pwa/install.service';
import { DisclaimerService } from '../../core/safety/disclaimer.service';
import { ThemeService, type ThemeMode } from '../../core/theme/theme.service';

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
  private readonly snack = inject(MatSnackBar);
  protected readonly install = inject(InstallService);
  protected readonly theme = inject(ThemeService);
  protected readonly audio = inject(AudioCueService);

  protected readonly name = new FormControl('', { nonNullable: true, validators: [Validators.maxLength(30)] });
  protected readonly busy = signal<'export' | 'import' | null>(null);
  protected readonly importProblems = signal<string[]>([]);
  protected readonly themes: { mode: ThemeMode; label: string; hint: string }[] = [
    { mode: 'system', label: 'Match my device', hint: 'Follows your light/dark setting' },
    { mode: 'light', label: 'Light', hint: 'Paper-coloured cards' },
    { mode: 'dark', label: 'Dark', hint: 'Easier in a dim room' },
  ];

  protected readonly info = resource({
    loader: async () => {
      const [me, contentVersion, acceptedAt] = await Promise.all([
        this.identity.me(), this.meta.get('contentVersion'), this.disclaimer.acceptedAt(),
      ]);
      this.name.setValue(me.name === 'You' ? '' : me.name);
      return { me, contentVersion, acceptedAt };
    },
  });

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

  protected showDisclaimer(): void {
    void this.disclaimer.open(false);
  }
}
