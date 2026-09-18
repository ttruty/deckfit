import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { InstallService } from '../../core/pwa/install.service';

/**
 * §11: offers "add to home screen" where the browser supports it, and the manual steps on iOS,
 * which never fires an install prompt. Hidden once installed or waved away.
 */
@Component({
  selector: 'df-install-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule],
  template: `
    @if (install.offer()) {
      <aside class="banner" data-install-banner>
        <mat-icon aria-hidden="true">install_mobile</mat-icon>
        <div class="text">
          <strong>Install DeckFit</strong>
          @if (install.state() === 'ios') {
            <span>Tap <mat-icon inline>ios_share</mat-icon> Share, then “Add to Home Screen” — it then works offline, full screen.</span>
          } @else {
            <span>Add it to your home screen: full screen, and your workouts keep working offline.</span>
          }
        </div>
        <div class="actions">
          @if (install.state() === 'prompt') {
            <button mat-flat-button (click)="install.install()">Install</button>
          }
          <button mat-button (click)="install.dismiss()">Not now</button>
        </div>
      </aside>
    }
  `,
  styles: `
    .banner {
      display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; margin-bottom: 16px;
      padding: 12px 16px; border-radius: 20px;
      background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container);
    }
    .text { flex: 1 1 260px; display: grid; gap: 2px; font: var(--mat-sys-body-medium); }
    .actions { display: flex; gap: 8px; align-items: center; }
  `,
})
export class InstallBannerComponent {
  protected readonly install = inject(InstallService);
}
