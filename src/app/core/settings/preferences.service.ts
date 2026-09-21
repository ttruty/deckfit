import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { AudioCueService } from '../audio/audio-cue.service';
import { MetaRepository } from '../db/repositories';
import { ThemeService, type ThemeMode } from '../theme/theme.service';
import { INTENSITIES, type Intensity } from '../../domain/models/schemas';

/**
 * Device preferences (theme, beeps, speech, intensity) stored in the Dexie `meta` table — §2 excludes
 * localStorage for app data. Loaded once at startup (from the lazy app initializer, so Dexie stays
 * out of the initial bundle) and written back whenever a signal changes.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  private readonly meta = inject(MetaRepository);
  private readonly theme = inject(ThemeService);
  private readonly audio = inject(AudioCueService);
  /** False until stored values are applied, so loading doesn't write them straight back. */
  readonly loaded = signal(false);
  /**
   * How hard this device wants to work by default (§6.1). Quick Start and new rooms use it;
   * a saved routine carries its own intensity instead.
   */
  readonly intensity = signal<Intensity>('moderate');

  constructor() {
    effect(() => {
      const [mode, beeps, speech, intensity] = [this.theme.mode(), this.audio.beeps(), this.audio.speech(), this.intensity()];
      if (!untracked(this.loaded)) return;
      void this.meta.set('theme', mode);
      void this.meta.set('beeps', beeps);
      void this.meta.set('speech', speech);
      void this.meta.set('intensity', intensity);
    });
  }

  async load(): Promise<void> {
    const [theme, beeps, speech, intensity] = await Promise.all([
      this.meta.get('theme'), this.meta.get('beeps'), this.meta.get('speech'), this.meta.get('intensity'),
    ]);
    if (theme) this.theme.set(theme as ThemeMode);
    if (beeps !== undefined) this.audio.beeps.set(beeps);
    if (speech !== undefined) this.audio.speech.set(speech);
    if (intensity && INTENSITIES.includes(intensity)) this.intensity.set(intensity);
    this.loaded.set(true);
  }
}
