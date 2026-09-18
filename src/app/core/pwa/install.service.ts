import { Injectable, computed, inject, signal } from '@angular/core';
import { MetaRepository } from '../db/repositories';
import { clearInstallPrompt, onInstallPrompt, pendingInstallPrompt } from './install-prompt';

export type InstallState =
  /** Already running as an installed app. */
  | 'installed'
  /** The browser offered a prompt we can fire. */
  | 'prompt'
  /** iOS Safari never offers one: show the Share → Add to Home Screen steps. */
  | 'ios'
  /** Nothing to offer (desktop browser without support, or already dismissed by the browser). */
  | 'none';

/** §11: "Add to home screen", offered by the app rather than the browser's own infobar. */
@Injectable({ providedIn: 'root' })
export class InstallService {
  private readonly meta = inject(MetaRepository);
  private readonly prompt = signal(pendingInstallPrompt());
  private readonly standalone = signal(isStandalone());
  /** Hidden after the user says "not now"; Settings still offers it. */
  readonly dismissed = signal(false);
  /** Set once the user decides, so the stored value loading late can't overwrite them. */
  private decided = false;

  readonly state = computed<InstallState>(() => {
    if (this.standalone()) return 'installed';
    if (this.prompt()) return 'prompt';
    return isIosBrowser() ? 'ios' : 'none';
  });
  /** Whether to show the banner: something to offer, and not waved away. */
  readonly offer = computed(() => !this.dismissed() && (this.state() === 'prompt' || this.state() === 'ios'));

  constructor() {
    onInstallPrompt((event) => this.prompt.set(event));
    if (typeof window !== 'undefined') {
      window.addEventListener('appinstalled', () => this.standalone.set(true));
      window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', (e) => this.standalone.set(e.matches));
    }
    void this.meta.get('installDismissedAt').then((at) => {
      if (!this.decided) this.dismissed.set(!!at);
    });
  }

  /** Fires the browser's install dialog. Returns true when the app was installed. */
  async install(): Promise<boolean> {
    const event = this.prompt();
    if (!event) return false;
    await event.prompt();
    const { outcome } = await event.userChoice;
    clearInstallPrompt();
    this.prompt.set(null);
    if (outcome === 'accepted') this.standalone.set(true);
    else await this.dismiss();
    return outcome === 'accepted';
  }

  async dismiss(): Promise<void> {
    this.decided = true;
    this.dismissed.set(true);
    await this.meta.set('installDismissedAt', Date.now());
  }

  /** Settings can bring the offer back. */
  async reset(): Promise<void> {
    this.decided = true;
    this.dismissed.set(false);
    await this.meta.set('installDismissedAt', 0);
  }
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

/** iOS (any browser there is Safari underneath) never fires `beforeinstallprompt`. */
function isIosBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
