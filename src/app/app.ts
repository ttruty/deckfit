import { ChangeDetectionStrategy, Component, DestroyRef, EnvironmentInjector, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { ActivatedRouteSnapshot, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { AudioCueService } from './core/audio/audio-cue.service';
import { ShellService } from './core/shell/shell.service';
import { ThemeMode, ThemeService } from './core/theme/theme.service';

interface NavItem { path: string; label: string; icon: string; exact: boolean }

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet, RouterLink, RouterLinkActive,
    MatToolbarModule, MatButtonModule, MatIconModule,
  ],
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  protected readonly theme = inject(ThemeService);
  private readonly router = inject(Router);

  private readonly shell = inject(ShellService);

  /** Full screen (no toolbar or nav) for routes with data.immersive, or while a screen requests it. */
  protected readonly immersive = computed(() => this.routeImmersive() || this.shell.immersive());
  private readonly routeImmersive = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => deepest(this.router.routerState.snapshot.root).data['immersive'] === true),
    ),
    { initialValue: false },
  );

  protected readonly nav: NavItem[] = [
    { path: '/', label: 'Home', icon: 'home', exact: true },
    { path: '/library', label: 'Library', icon: 'fitness_center', exact: false },
    { path: '/decks', label: 'Decks', icon: 'style', exact: false },
    { path: '/games', label: 'Games', icon: 'casino', exact: false },
    { path: '/history', label: 'History', icon: 'history', exact: false },
  ];

  protected readonly themes: { mode: ThemeMode; label: string; icon: string }[] = [
    { mode: 'system', label: 'System', icon: 'brightness_auto' },
    { mode: 'light', label: 'Light', icon: 'light_mode' },
    { mode: 'dark', label: 'Dark', icon: 'dark_mode' },
  ];

  constructor() {
    // The update prompt and the safety notice load lazily: both pull in the CDK overlay (and
    // Dexie), which must stay out of the initial bundle (§4). The app can be torn down before a
    // dynamic import resolves (tests, a fast navigation), so check before touching the injector.
    const injector = inject(EnvironmentInjector);
    const destroyRef = inject(DestroyRef);
    let alive = true;
    destroyRef.onDestroy(() => (alive = false));
    const whenAlive = <T>(load: Promise<T>, use: (module: T) => void) => {
      load.then((module) => (alive ? use(module) : undefined)).catch((err: unknown) => console.warn('Startup task failed', err));
    };
    whenAlive(import('./core/pwa/app-update.service'), ({ AppUpdateService }) => injector.get(AppUpdateService).start());
    // §12: the safety notice, once per device, and then (§12a) the welcome guide — in that
    // order, so the notice is never buried behind the guide.
    whenAlive(import('./core/safety/disclaimer.service'), ({ DisclaimerService }) => {
      void injector.get(DisclaimerService).ensureAccepted().then(() => {
        whenAlive(import('./core/tour/tour.service'), ({ TourService }) => void injector.get(TourService).maybeOpenOnFirstRun());
      });
    });

    // iOS only allows audio to start inside a user gesture: unlock on the first tap anywhere.
    const audio = inject(AudioCueService);
    const unlock = () => audio.unlock();
    for (const event of ['pointerdown', 'keydown'] as const) {
      document.addEventListener(event, unlock, { once: true, passive: true });
      destroyRef.onDestroy(() => document.removeEventListener(event, unlock));
    }
  }

  protected readonly currentTheme = computed(() => this.themes.find((t) => t.mode === this.theme.mode()) ?? this.themes[0]);

  protected cycleTheme(): void {
    const i = this.themes.findIndex((t) => t.mode === this.theme.mode());
    this.theme.set(this.themes[(i + 1) % this.themes.length].mode);
  }
}

function deepest(route: ActivatedRouteSnapshot): ActivatedRouteSnapshot {
  return route.firstChild ? deepest(route.firstChild) : route;
}
