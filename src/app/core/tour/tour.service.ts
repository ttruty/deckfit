import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { MetaRepository } from '../db/repositories';
import { TourDialog } from './tour.dialog';

/**
 * §12a: the welcome guide. It opens once, on the first launch after the safety notice, and never
 * again on its own — `tourSeenAt` records that. Settings can replay it, and `tourEnabled: false`
 * turns the first-run offer off for good (turning it back on re-arms it for the next launch).
 */
@Injectable({ providedIn: 'root' })
export class TourService {
  private readonly meta = inject(MetaRepository);
  private readonly dialog = inject(MatDialog);

  seenAt(): Promise<number | undefined> {
    return this.meta.get('tourSeenAt');
  }

  /** Whether the guide may open by itself (default on, until someone turns it off). */
  async enabled(): Promise<boolean> {
    return (await this.meta.get('tourEnabled')) ?? true;
  }

  /** Settings toggle. Turning it back on means "show it again next launch". */
  async setEnabled(enabled: boolean): Promise<void> {
    await this.meta.set('tourEnabled', enabled);
    if (enabled) await this.meta.set('tourSeenAt', 0);
  }

  /** First launch only: shows the guide unless it has been seen or switched off. */
  async maybeOpenOnFirstRun(): Promise<void> {
    if (await this.seenAt()) return;
    if (!(await this.enabled())) return;
    await this.open();
  }

  /** Opens the guide now (Settings → Show the guide). Any way of closing counts as seen. */
  async open(): Promise<void> {
    const ref = this.dialog.open(TourDialog, { maxWidth: '460px', autoFocus: 'dialog', panelClass: 'df-tour-panel' });
    await firstValueFrom(ref.afterClosed());
    await this.meta.set('tourSeenAt', Date.now());
  }
}
