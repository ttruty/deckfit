import { ChangeDetectionStrategy, Component, EnvironmentInjector, computed, inject } from '@angular/core';
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
    // Loaded lazily: the update prompt needs the snackbar, which would otherwise pull the CDK
    // overlay into the initial bundle (§4).
    const injector = inject(EnvironmentInjector);
    void import('./core/pwa/app-update.service').then(({ AppUpdateService }) => injector.get(AppUpdateService).start());
    // §12: the safety notice, once per device (also lazy: dialog + Dexie).
    void import('./core/safety/disclaimer.service').then(({ DisclaimerService }) => injector.get(DisclaimerService).ensureAccepted());
    // iOS only allows audio to start inside a user gesture: unlock on the first tap anywhere.
    const audio = inject(AudioCueService);
    const unlock = () => audio.unlock();
    for (const event of ['pointerdown', 'keydown'] as const) {
      document.addEventListener(event, unlock, { once: true, passive: true });
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
