import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, signal } from '@angular/core';

export type ThemeMode = 'system' | 'light' | 'dark';

/**
 * Applies the theme by stamping data-theme on <html>; 'system' removes it so
 * prefers-color-scheme decides. styles.scss maps data-theme to color-scheme
 * (Material) and _card-tokens.scss swaps paper/ink. PreferencesService loads and stores the
 * choice in Dexie `meta` (this service stays free of Dexie so it can live in the shell bundle).
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly root = inject(DOCUMENT).documentElement;
  readonly mode = signal<ThemeMode>('system');

  constructor() {
    effect(() => {
      const mode = this.mode();
      if (mode === 'system') delete this.root.dataset['theme'];
      else this.root.dataset['theme'] = mode;
    });
  }

  set(mode: ThemeMode): void {
    this.mode.set(mode);
  }
}
