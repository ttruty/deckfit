import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { InstallService } from '../../core/pwa/install.service';
import { DfIconComponent } from '../../shared/ui/icon/df-icon.component';

/**
 * §11: offers "add to home screen" where the browser supports it, and the manual steps on iOS,
 * which never fires an install prompt. Hidden once installed or waved away.
 */
@Component({
  selector: 'df-install-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DfIconComponent],
  template: `
    @if (install.offer()) {
      <section class="df-section df-install" aria-label="Install DeckFit" data-install-banner>
        <df-icon name="install" />
        <p class="df-install__text">
          <strong>Install DeckFit</strong>
          @if (install.state() === 'ios') {
            <span class="df-hint">In Safari, tap Share, then “Add to Home Screen”.</span>
          } @else {
            <span class="df-hint">Full screen, and workouts keep working offline.</span>
          }
        </p>
        <div class="df-install__actions">
          <button type="button" class="df-btn df-btn--text" (click)="install.dismiss()">Not now</button>
          @if (install.state() === 'prompt') {
            <button type="button" class="df-btn df-btn--outline" (click)="install.install()">Install</button>
          }
        </div>
      </section>
    }
  `,
  styles: `
    :host { display: contents; }
    .df-install { flex-direction: row; align-items: center; flex-wrap: wrap; gap: 12px; }
    .df-install > df-icon { color: var(--df-text-muted); }
    .df-install__text { flex: 1 1 200px; display: flex; flex-direction: column; margin: 0; }
    .df-install__text strong { font-weight: 500; }
    .df-install__actions { display: flex; gap: 4px; margin-left: auto; }
  `,
})
export class InstallBannerComponent {
  protected readonly install = inject(InstallService);
}
