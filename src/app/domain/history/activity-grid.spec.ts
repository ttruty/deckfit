import type { Session } from '../models/schemas';
import { activityGrid, dayKey } from './activity-grid';
import type { SessionRow } from './history-stats';

/** A day at noon local time, so nothing here depends on the runner's timezone. */
function at(date: string, hour = 12): number {
  return new Date(`${date}T${String(hour).padStart(2, '0')}:00:00`).getTime();
}

function row(date: string, reps = 10, seconds = 0): SessionRow {
  return {
    session: { startedAt: at(date) } as Session,
    reps,
    seconds,
    tasks: 1,
    minutes: 5,
    inProgress: false,
    exercises: [],
    groups: [],
  };
}

const TODAY = at('2026-03-18'); // a Wednesday

describe('activityGrid', () => {
  it('lays out whole weeks, Monday first, ending with the week that holds today', () => {
    const grid = activityGrid([], TODAY, 4);
    expect(grid.weeks).toHaveLength(4);
    for (const week of grid.weeks) expect(week).toHaveLength(7);
    expect(new Date(grid.weeks[0][0].at).getDay()).toBe(1); // Monday
    expect(grid.weeks.at(-1)!.map((d) => d.date)).toContain(dayKey(TODAY));
  });

  it('marks the days after today so the last column reads as unfinished', () => {
    const last = activityGrid([], TODAY, 2).weeks.at(-1)!;
    expect(last.filter((d) => d.future).map((d) => d.date)).toEqual(['2026-03-19', '2026-03-20', '2026-03-21', '2026-03-22']);
  });

  it('counts a day by local date, sums its workouts, and scores 5 seconds as 1 point', () => {
    const grid = activityGrid([row('2026-03-16', 20), row('2026-03-16', 0, 50), row('2026-03-10', 5)], TODAY, 4);
    const day = grid.weeks.flat().find((d) => d.date === '2026-03-16')!;
    expect(day.workouts).toBe(2);
    expect(day.points).toBe(30); // 20 reps + 50s ÷ 5
    expect(grid.activeDays).toBe(2);
    expect(grid.points).toBe(35);
  });

  it('shades by fixed rep bands, so a square means the same thing every time', () => {
    const days = ['2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14', '2026-03-16'];
    const reps = [0, 1, 30, 31, 60, 90, 91];
    const grid = activityGrid(days.map((d, i) => row(d, reps[i])), TODAY, 4);
    const level = (date: string) => grid.weeks.flat().find((d) => d.date === date)!.level;
    expect(days.map(level)).toEqual([0, 1, 1, 2, 2, 3, 4]);
  });

  it('bands on reps only, but keeps the timed work for the label', () => {
    const grid = activityGrid([row('2026-03-16', 0, 300)], TODAY, 4);
    const day = grid.weeks.flat().find((d) => d.date === '2026-03-16')!;
    expect(day).toMatchObject({ level: 0, reps: 0, seconds: 300, workouts: 1, points: 60 });
  });

  it('marks today and counts the days drawn', () => {
    const grid = activityGrid([], TODAY, 4);
    expect(grid.days).toBe(28);
    expect(grid.weeks.flat().filter((d) => d.today).map((d) => d.date)).toEqual(['2026-03-18']);
  });

  it('a late-night workout belongs to the day it started, not to UTC', () => {
    const grid = activityGrid([{ ...row('2026-03-17'), session: { startedAt: at('2026-03-17', 23) } as Session }], TODAY, 4);
    expect(grid.weeks.flat().find((d) => d.date === '2026-03-17')!.workouts).toBe(1);
  });

  describe('streaks', () => {
    it('counts back from today', () => {
      const grid = activityGrid([row('2026-03-18'), row('2026-03-17'), row('2026-03-16')], TODAY, 4);
      expect(grid.currentStreak).toBe(3);
      expect(grid.bestStreak).toBe(3);
    });

    it('is not broken by a today you have not done yet', () => {
      const grid = activityGrid([row('2026-03-17'), row('2026-03-16')], TODAY, 4);
      expect(grid.currentStreak).toBe(2);
    });

    it('is broken by a missed day', () => {
      const grid = activityGrid([row('2026-03-16'), row('2026-03-15'), row('2026-03-14')], TODAY, 4);
      expect(grid.currentStreak).toBe(0);
      expect(grid.bestStreak).toBe(3);
    });

    it('remembers the best run even when it is out of view', () => {
      const old = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08'].map((d) => row(d));
      const grid = activityGrid([...old, row('2026-03-18')], TODAY, 2);
      expect(grid.bestStreak).toBe(4);
      expect(grid.currentStreak).toBe(1);
    });

    it('is zero with nothing logged', () => {
      const grid = activityGrid([], TODAY, 4);
      expect(grid.currentStreak).toBe(0);
      expect(grid.bestStreak).toBe(0);
      expect(grid.activeDays).toBe(0);
    });
  });

  it('labels a column only when the month changes, and never so close the labels collide', () => {
    const grid = activityGrid([], TODAY, 6);
    expect(grid.months.filter((m) => m !== null).length).toBeGreaterThan(0);
    expect(grid.months.length).toBe(grid.weeks.length);
    const labelled = grid.months.map((m, i) => (m ? new Date(grid.weeks[i][0].at).getMonth() : null)).filter((m) => m !== null);
    expect(new Set(labelled).size).toBe(labelled.length); // each month labelled once

    const at = grid.months.flatMap((m, i) => (m ? [i] : []));
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(2);
  });
});
