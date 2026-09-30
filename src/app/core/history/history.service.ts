import { Injectable, inject } from '@angular/core';
import { dayKey } from '../../domain/challenges/progress';
import { activityGrid, type ActivityGrid } from '../../domain/history/activity-grid';
import { historyStats, type HistoryStats } from '../../domain/history/history-stats';
import type { Exercise } from '../../domain/models/schemas';
import { ExerciseRepository, SessionRepository } from '../db/repositories';
import { Clock } from '../time/clock.service';

export interface HistorySnapshot {
  stats: HistoryStats;
  exercises: ReadonlyMap<string, Exercise>;
  /** The last 26 weeks of days, with the streaks (§9e). */
  grid: ActivityGrid;
}

/**
 * Everything both History and Home need from saved workouts, loaded once. Home only wants the
 * headline (streak, reps this week); History wants the lot, and both come from the same rows.
 */
@Injectable({ providedIn: 'root' })
export class HistoryService {
  private readonly sessions = inject(SessionRepository);
  private readonly exercises = inject(ExerciseRepository);
  private readonly clock = inject(Clock);

  async load(): Promise<HistorySnapshot> {
    const [sessions, exercises] = await Promise.all([this.sessions.list(), this.exercises.list()]);
    const byId = new Map(exercises.map((e) => [e.id, e]));
    const stats = historyStats(sessions, byId);
    return { stats, exercises: byId, grid: activityGrid(stats.sessions, this.clock.epoch()) };
  }

  /** Home's one line: the streak and the week's reps. */
  async headline(): Promise<{ streak: number; repsThisWeek: number; workouts: number }> {
    const { stats, grid } = await this.load();
    const from = new Date(this.clock.epoch());
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - 6);
    const since = dayKey(from.getTime());
    return {
      streak: grid.currentStreak,
      repsThisWeek: stats.sessions
        .filter((row) => dayKey(row.session.startedAt) >= since)
        .reduce((n, row) => n + row.reps, 0),
      workouts: stats.workouts,
    };
  }
}
