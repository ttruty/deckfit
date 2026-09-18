import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { MetaRepository } from '../db/repositories';
import { DisclaimerDialog, type DisclaimerData } from './disclaimer.dialog';

/** §12: the safety notice must be accepted once per device; the date lives in `meta`. */
@Injectable({ providedIn: 'root' })
export class DisclaimerService {
  private readonly meta = inject(MetaRepository);
  private readonly dialog = inject(MatDialog);

  acceptedAt(): Promise<number | undefined> {
    return this.meta.get('disclaimerAcceptedAt');
  }

  /** Shows the notice if it hasn't been accepted on this device. */
  async ensureAccepted(): Promise<void> {
    if (await this.acceptedAt()) return;
    await this.open(true);
  }

  /** Opens the notice; on first run it can't be dismissed without accepting. */
  async open(mustAccept: boolean): Promise<void> {
    const data: DisclaimerData = { mustAccept, acceptedAt: await this.acceptedAt() };
    const ref = this.dialog.open(DisclaimerDialog, { data, disableClose: mustAccept, maxWidth: '520px', autoFocus: 'dialog' });
    const accepted = await firstValueFrom(ref.afterClosed());
    if (mustAccept && accepted) await this.meta.set('disclaimerAcceptedAt', Date.now());
  }
}
