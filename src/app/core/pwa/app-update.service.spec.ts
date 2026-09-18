import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SwUpdate, type VersionEvent } from '@angular/service-worker';
import { Subject, of } from 'rxjs';
import { AppUpdateService } from './app-update.service';

function setup(isEnabled: boolean) {
  const versionUpdates = new Subject<VersionEvent>();
  const unrecoverable = new Subject<{ reason: string; type: 'UNRECOVERABLE_STATE' }>();
  const checkForUpdate = vi.fn().mockResolvedValue(false);
  const actions = new Subject<void>();
  const open = vi.fn().mockReturnValue({ onAction: () => actions });
  TestBed.configureTestingModule({
    providers: [
      { provide: SwUpdate, useValue: { isEnabled, versionUpdates, unrecoverable, checkForUpdate } },
      { provide: MatSnackBar, useValue: { open } },
      { provide: ApplicationRef, useValue: { isStable: of(true) } },
    ],
  });
  return { service: TestBed.inject(AppUpdateService), versionUpdates, unrecoverable, checkForUpdate, open, actions };
}

describe('AppUpdateService', () => {
  it('offers a reload when a new version is ready, and reloads when the user takes it', () => {
    const { service, versionUpdates, open, actions } = setup(true);
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload } as unknown as Location);
    service.start();

    versionUpdates.next({ type: 'VERSION_DETECTED', version: { hash: 'a' } });
    expect(open).not.toHaveBeenCalled();

    versionUpdates.next({ type: 'VERSION_READY', currentVersion: { hash: 'a' }, latestVersion: { hash: 'b' } });
    expect(open).toHaveBeenCalledWith('New version available', 'Reload', {});
    expect(reload).not.toHaveBeenCalled();
    actions.next();
    expect(reload).toHaveBeenCalled();
  });

  it('offers a reload when the cached app is damaged, and checks for updates once stable', () => {
    const { service, unrecoverable, open, checkForUpdate } = setup(true);
    service.start();
    expect(checkForUpdate).toHaveBeenCalled();
    unrecoverable.next({ type: 'UNRECOVERABLE_STATE', reason: 'corrupt' });
    expect(open).toHaveBeenCalledWith('The offline copy of DeckFit is damaged.', 'Reload', {});
  });

  it('does nothing when the service worker is disabled (dev builds)', () => {
    const { service, versionUpdates, open, checkForUpdate } = setup(false);
    service.start();
    versionUpdates.next({ type: 'VERSION_READY', currentVersion: { hash: 'a' }, latestVersion: { hash: 'b' } });
    expect(open).not.toHaveBeenCalled();
    expect(checkForUpdate).not.toHaveBeenCalled();
  });
});
