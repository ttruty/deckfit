import {
  ApplicationConfig, Injector, inject, isDevMode, provideAppInitializer, provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { provideServiceWorker } from '@angular/service-worker';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch()),
    // Seed built-in content into Dexie before the first screen reads it. A failure (e.g.
    // offline before the service worker cached content) must not block the app.
    // Lazy import keeps Dexie + Zod out of the initial bundle.
    provideAppInitializer(() => {
      const injector = inject(Injector);
      // Preferences first: the stored theme should apply before the first screen paints.
      const prefs = import('./core/settings/preferences.service')
        .then((m) => injector.get(m.PreferencesService).load())
        .catch((err: unknown) => console.warn('Could not load preferences', err));
      const seeded = import('./core/content/content-seed.service')
        .then((m) => injector.get(m.ContentSeedService).ensureSeeded())
        .catch((err: unknown) => console.warn('Content seeding failed; using stored content', err));
      return Promise.all([prefs, seeded]);
    }),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
