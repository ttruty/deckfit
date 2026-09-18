import { Injectable, computed, signal } from '@angular/core';

/** App-shell state screens can influence (e.g. a live game hiding the toolbar and nav). */
@Injectable({ providedIn: 'root' })
export class ShellService {
  /** Number of active requests for full-screen mode (nested screens can each hold one). */
  private readonly holds = signal(0);
  readonly immersive = computed(() => this.holds() > 0);

  /** Enters full-screen mode; call the returned function to release it. */
  requestImmersive(): () => void {
    this.holds.update((n) => n + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holds.update((n) => Math.max(0, n - 1));
    };
  }
}
