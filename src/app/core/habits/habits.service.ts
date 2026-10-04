import { Injectable, inject, signal } from '@angular/core';
import { z } from 'zod';
import { MetaRepository, SessionRepository } from '../db/repositories';
import { Clock } from '../time/clock.service';
import type { Session } from '../../domain/models/schemas';
import {
  createReporter,
  localDateKey,
  type HabitsEvent,
  type Reporter,
  type ReporterStatus,
} from './habits-reporter';

/** Settings for reporting to Habits (§16). Off until both fields are filled and it's switched on. */
export const HabitsSettingsSchema = z.object({
  enabled: z.boolean(),
  url: z.string().max(500),
  token: z.string().max(200),
});
export type HabitsSettings = z.infer<typeof HabitsSettingsSchema>;

const OFF: HabitsSettings = { enabled: false, url: '', token: '' };

/** How far back `catchUp()` re-reports ended workouts. */
const CATCH_UP_MS = 7 * 24 * 60 * 60 * 1000;

/** The reporter's queue lives in Dexie `meta` too: §2 keeps app data out of localStorage. */
const QueueSchema = z.array(z.looseObject({ externalId: z.string().min(1) }));

/**
 * Reports ended workouts to the owner's Habits scorecard (§16): facts only, never "done".
 * Nothing is queued or sent while reporting is off.
 */
@Injectable({ providedIn: 'root' })
export class HabitsService {
  private readonly meta = inject(MetaRepository);
  private readonly sessions = inject(SessionRepository);
  private readonly clock = inject(Clock);
  readonly settings = signal<HabitsSettings>(OFF);
  readonly status = signal<ReporterStatus['state']>('off');
  private reporter: Reporter | undefined;
  private loaded: Promise<void> | undefined;

  /** Stored settings; call before showing them. Safe to call repeatedly. */
  load(): Promise<void> {
    return (this.loaded ??= this.meta.get('habitsReporting').then((stored) => {
      const parsed = HabitsSettingsSchema.safeParse(stored);
      this.settings.set(parsed.success ? parsed.data : OFF);
    }));
  }

  async update(patch: Partial<HabitsSettings>): Promise<void> {
    await this.load();
    this.settings.update((s) => ({ ...s, ...patch }));
    await this.meta.set('habitsReporting', this.settings());
    if (this.settings().enabled) void this.catchUp();
  }

  /**
   * Re-reports every workout that ended in the last week, then sends the queue. Runs at startup and
   * when reporting is switched on, so a workout whose send was lost (app closed or killed before it
   * went out, offline until the next launch) still arrives. Habits ignores ones it already has.
   */
  async catchUp(): Promise<void> {
    try {
      await this.load();
      if (!this.settings().enabled) return;
      const reporter = this.ensureReporter();
      const since = this.clock.epoch() - CATCH_UP_MS;
      for (const session of await this.sessions.list(100)) {
        const event = session.endedAt && session.endedAt >= since ? toHabitsEvent(session) : null;
        if (event) await reporter.report(event);
      }
      await reporter.flush();
    } catch (err) {
      console.warn('Could not catch up with Habits', err);
    }
  }

  /** An ended session (finished or abandoned) as a `workout.completed` event. */
  reportSession(session: Session): void {
    const event = toHabitsEvent(session);
    if (!event) return;
    void this.load().then(() => this.ensureReporter().report(event));
  }

  private ensureReporter(): Reporter {
    return (this.reporter ??= createReporter({
      config: async () => {
        await this.load();
        const s = this.settings();
        return s.enabled && s.url.trim() && s.token.trim()
          ? { url: s.url.trim(), token: s.token.trim() }
          : null;
      },
      store: {
        load: async () => {
          const parsed = QueueSchema.safeParse(await this.meta.get('habitsQueue'));
          return parsed.success ? (parsed.data as unknown as HabitsEvent[]) : [];
        },
        save: (events) => this.meta.set('habitsQueue', events),
      },
      onStatus: (s) => this.status.set(s.state),
    }));
  }
}

/** Null for a session that hasn't ended. */
export function toHabitsEvent(session: Session): HabitsEvent | null {
  if (!session.endedAt) return null;
  const ended = new Date(session.endedAt);
  return {
    externalId: session.id,
    type: 'workout.completed',
    occurredAt: ended.toISOString(),
    localDate: localDateKey(ended),
    value: Math.max(0, Math.round((session.endedAt - session.startedAt) / 1000)),
    unit: 'seconds',
    meta: {
      game: session.game.name,
      deck: session.deck.name,
      outcome: session.outcome ?? 'finished',
      ...(session.roomId ? { room: true } : {}),
    },
  };
}
