/** Time and timers for sync protocols; injectable so tests control time without faking globals. */
export interface Scheduler {
  /** Wall-clock epoch milliseconds (this device's clock, possibly skewed). */
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realScheduler: Scheduler = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** Manually advanced scheduler for tests. `skew` offsets this device's clock. */
export class ManualScheduler implements Scheduler {
  private t = 1_000_000;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; fn: () => void }>();

  constructor(private readonly skew = 0) {}

  now(): number {
    return this.t + this.skew;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { at: this.t + ms, fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  /** Advances time, firing due timers in order (timers scheduled while firing are honored). */
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.t = due[1].at;
      due[1].fn();
    }
    this.t = end;
  }

  /** Shares the base time of another scheduler (different skews, same "real" time). */
  syncTo(other: ManualScheduler): void {
    this.t = other.t;
  }
}
