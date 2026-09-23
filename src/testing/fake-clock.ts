import { TestBed } from '@angular/core/testing';
import { Clock } from '../app/core/time/clock.service';

/** Manually advanced Clock for timer tests. */
export class FakeClock extends Clock {
  private t = 1_000;
  private wall = Date.UTC(2026, 8, 16, 12, 0, 0);

  private readonly intervals = new Set<{ ms: number; next: number; fn: () => void }>();

  override now(): number {
    return this.t;
  }

  override epoch(): number {
    return this.wall;
  }

  override every(ms: number, fn: () => void): () => void {
    const entry = { ms, next: this.t + ms, fn };
    this.intervals.add(entry);
    return () => this.intervals.delete(entry);
  }

  /** Pins wall-clock time (what `epoch()` returns), for anything counted in calendar days. */
  setEpoch(at: number): void {
    this.wall = at;
  }

  /** Moves time forward, firing intervals in order. */
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      const due = [...this.intervals].filter((i) => i.next <= end).sort((a, b) => a.next - b.next)[0];
      if (!due) break;
      this.wall += due.next - this.t;
      this.t = due.next;
      due.next += due.ms;
      due.fn();
    }
    this.wall += end - this.t;
    this.t = end;
  }
}

export function provideFakeClock(epoch?: number): FakeClock {
  const clock = new FakeClock();
  if (epoch !== undefined) clock.setEpoch(epoch);
  TestBed.configureTestingModule({ providers: [{ provide: Clock, useValue: clock }, { provide: FakeClock, useExisting: Clock }] });
  return clock;
}
