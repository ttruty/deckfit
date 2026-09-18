import { ApplicationRef, Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SwUpdate } from '@angular/service-worker';
import { concat, first, interval } from 'rxjs';
import { filter } from 'rxjs/operators';

/** How often to look for a new build once the app is stable. */
export const UPDATE_CHECK_MS = 30 * 60 * 1000;

/**
 * §11 update flow: when the service worker has a new version ready, offer a reload. Checks once
 * the app is stable and then periodically, so a long-lived tab (a phone left on the play screen)
 * still finds updates. A no-op where the service worker is disabled (dev, unsupported browsers).
 */
@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  private readonly updates = inject(SwUpdate);
  private readonly snack = inject(MatSnackBar);
  private readonly appRef = inject(ApplicationRef);

  start(): void {
    if (!this.updates.isEnabled) return;

    this.updates.versionUpdates.pipe(filter((e) => e.type === 'VERSION_READY')).subscribe(() => {
      this.snack.open('New version available', 'Reload', {}).onAction().subscribe(() => location.reload());
    });

    // An unrecoverable state means the cached app is broken; a reload re-fetches everything.
    this.updates.unrecoverable.subscribe(() => {
      this.snack.open('The offline copy of DeckFit is damaged.', 'Reload', {}).onAction().subscribe(() => location.reload());
    });

    concat(this.appRef.isStable.pipe(first((stable) => stable)), interval(UPDATE_CHECK_MS)).subscribe(() => {
      void this.updates.checkForUpdate().catch(() => undefined);
    });
  }
}
