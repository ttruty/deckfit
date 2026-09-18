import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';

/**
 * Keeps the screen on during play (§9) via the Screen Wake Lock API. The browser
 * releases the lock when the page is hidden, so it is re-acquired on return.
 * No-op where unsupported.
 */
@Injectable({ providedIn: 'root' })
export class WakeLockService {
  private readonly document = inject(DOCUMENT);
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;
  readonly active = signal(false);

  private readonly onVisibility = () => {
    if (this.wanted && this.document.visibilityState === 'visible') void this.acquire();
  };

  get supported(): boolean {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  }

  async request(): Promise<void> {
    this.wanted = true;
    this.document.addEventListener('visibilitychange', this.onVisibility);
    await this.acquire();
  }

  async release(): Promise<void> {
    this.wanted = false;
    this.document.removeEventListener('visibilitychange', this.onVisibility);
    const s = this.sentinel;
    this.sentinel = null;
    this.active.set(false);
    await s?.release().catch(() => undefined);
  }

  private async acquire(): Promise<void> {
    if (!this.supported || this.sentinel) return;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.active.set(true);
      this.sentinel.addEventListener('release', () => {
        this.sentinel = null;
        this.active.set(false);
      });
    } catch {
      this.active.set(false); // e.g. battery saver or not visible; retried on next visibility change
    }
  }
}
