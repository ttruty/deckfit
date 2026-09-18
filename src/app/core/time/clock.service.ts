import { Injectable } from '@angular/core';

/** Time source for timers and countdowns; swap in tests to control time. */
@Injectable({ providedIn: 'root' })
export class Clock {
  /** Monotonic milliseconds, for measuring durations. */
  now(): number {
    return performance.now();
  }

  /** Wall-clock epoch milliseconds, for timestamps. */
  epoch(): number {
    return Date.now();
  }

  /** Calls `fn` every `ms`; returns a stop function. */
  every(ms: number, fn: () => void): () => void {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  }
}
