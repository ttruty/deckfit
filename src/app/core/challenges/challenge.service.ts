import { Injectable, inject, signal } from '@angular/core';
import { challengeStandings, ownStatus, type ChallengeStandings, type OwnStatus } from '../../domain/challenges/standings';
import { dailyWork, dayKey, daysToUpload, debtRemaining, sessionWork, type WorkDay } from '../../domain/challenges/progress';
import type { Challenge, ChallengeState } from '../../domain/models/challenge.schema';
import { SessionRepository } from '../db/repositories';
import { IdentityService } from '../identity/identity.service';
import { REALTIME_CONFIGURED } from '../sync/realtime-config';
import { Clock } from '../time/clock.service';
import { ChallengeError, type ChallengeGateway, type NewChallenge } from './challenge-gateway';
import { CHALLENGE_GATEWAY_FACTORY } from './challenge.providers';

export interface ChallengeView {
  state: ChallengeState;
  standings: ChallengeStandings;
  me: string;
  /** Reps this device still owes from the pot, after any work done since it ended. */
  myDebt: number;
  /** True when this device has joined (only members report days). */
  joined: boolean;
}

export interface MyChallenge {
  challenge: Challenge;
  /** Where this device stands, from its own sessions — no extra request per challenge. */
  status: OwnStatus;
}

/**
 * Async challenges (§7b): the device's own work goes up, everyone's standings come down.
 *
 * What a device sends is only ever its own days, taken from its saved sessions — the same
 * numbers History shows. Everything else is read.
 */
@Injectable({ providedIn: 'root' })
export class ChallengeService {
  private readonly factory = inject(CHALLENGE_GATEWAY_FACTORY);
  private readonly identity = inject(IdentityService);
  private readonly sessions = inject(SessionRepository);
  private readonly clock = inject(Clock);
  private cached: Promise<ChallengeGateway> | null = null;

  /** False when no backend is configured: challenges then live in this browser only. */
  readonly shared = inject(REALTIME_CONFIGURED);
  /** Set when the tables are missing, so a screen can say which migration to run. */
  readonly setupNeeded = signal(false);

  async create(input: NewChallenge): Promise<Challenge> {
    const gateway = await this.gateway();
    const me = await this.member();
    const challenge = await this.guard(() => gateway.create(input, me));
    await this.sync(challenge.id);
    return challenge;
  }

  /** Looks a code up without joining, so the joiner can read the terms first. */
  async peek(code: string): Promise<ChallengeState | null> {
    const gateway = await this.gateway();
    return this.guard(() => gateway.byCode(code));
  }

  async join(code: string): Promise<Challenge> {
    const gateway = await this.gateway();
    const found = await this.guard(() => gateway.byCode(code));
    if (!found) throw new ChallengeError(`No challenge with the code ${code.toUpperCase()}.`, 'not-found');
    const me = await this.member();
    await this.guard(() => gateway.join(found.challenge.id, me));
    await this.sync(found.challenge.id);
    return found.challenge;
  }

  async leave(challengeId: string): Promise<void> {
    const gateway = await this.gateway();
    const me = await this.identity.me();
    await this.guard(() => gateway.leave(challengeId, me.id));
  }

  /** Challenges this device is in. */
  async mine(): Promise<Challenge[]> {
    const gateway = await this.gateway();
    const me = await this.identity.me();
    return this.guard(() => gateway.mine(me.id));
  }

  /**
   * Yours, with where you stand in each — worked out locally, so Home can show them for the cost
   * of one request. Running and upcoming ones first, then anything that ended recently.
   */
  async myChallenges(): Promise<MyChallenge[]> {
    const work = await this.myWork();
    const today = dayKey(this.clock.epoch());
    const recent = new Date(this.clock.epoch());
    recent.setDate(recent.getDate() - 7);
    const cutoff = dayKey(recent.getTime());
    return (await this.mine())
      .map((challenge) => ({ challenge, status: ownStatus(challenge, work, today) }))
      .filter(({ challenge, status }) => !status.over || challenge.endsOn >= cutoff)
      .sort((a, b) => rank(a) - rank(b) || a.challenge.endsOn.localeCompare(b.challenge.endsOn));
  }

  /** Loads a challenge, sends anything new of this device's, and works out where everyone stands. */
  async open(code: string): Promise<ChallengeView | null> {
    const gateway = await this.gateway();
    const me = await this.identity.me();
    const found = await this.guard(() => gateway.byCode(code));
    if (!found) return null;
    const joined = found.members.some((m) => m.playerId === me.id);
    const state = joined ? await this.report(gateway, found) : found;
    return this.view(state, me.id);
  }

  /** Sends this device's progress for every challenge it's in (after a workout, say). */
  async syncAll(): Promise<void> {
    if (!this.shared) return;
    try {
      const gateway = await this.gateway();
      const me = await this.identity.me();
      const challenges = await gateway.mine(me.id);
      const work = await this.myWork();
      const today = dayKey(this.clock.epoch());
      for (const challenge of challenges) {
        if (challenge.endsOn < today) continue; // finished: nothing left to report
        const found = await gateway.byCode(challenge.code);
        if (found) await this.report(gateway, found, work);
      }
    } catch {
      // Progress catches up next time the app is open; never get in the way of a workout.
    }
  }

  watch(challengeId: string, onChange: () => void): () => void {
    let stop: (() => void) | null = null;
    let cancelled = false;
    void this.gateway().then((gateway) => {
      if (cancelled) return;
      stop = gateway.watch(challengeId, onChange);
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }

  /** This device's work per local day, from its saved sessions (the History numbers). */
  async myWork(): Promise<Map<string, WorkDay>> {
    const sessions = await this.sessions.list();
    return dailyWork(sessions.map(sessionWork));
  }

  private async report(gateway: ChallengeGateway, state: ChallengeState, work?: Map<string, WorkDay>): Promise<ChallengeState> {
    const me = await this.identity.me();
    const mine = work ?? (await this.myWork());
    const rows = daysToUpload(state.challenge, me.id, mine, state.days);
    if (!rows.length) return state;
    await gateway.reportDays(state.challenge.id, rows);
    const keep = state.days.filter((d) => !rows.some((r) => r.playerId === d.playerId && r.day === d.day));
    return { ...state, days: [...keep, ...rows] };
  }

  private async view(state: ChallengeState, me: string): Promise<ChallengeView> {
    const standings = challengeStandings(state, dayKey(this.clock.epoch()));
    const owed = standings.players.find((p) => p.playerId === me)?.owed ?? 0;
    return {
      state,
      standings,
      me,
      myDebt: owed ? debtRemaining(owed, state.challenge.endsOn, await this.myWork()) : 0,
      joined: state.members.some((m) => m.playerId === me),
    };
  }

  private async sync(challengeId: string): Promise<void> {
    const gateway = await this.gateway();
    const mine = await gateway.mine((await this.identity.me()).id);
    const challenge = mine.find((c) => c.id === challengeId);
    const found = challenge ? await gateway.byCode(challenge.code) : null;
    if (found) await this.report(gateway, found);
  }

  private gateway(): Promise<ChallengeGateway> {
    return (this.cached ??= this.identity.me().then((me) => this.factory(me.id)));
  }

  /** Turns "the tables aren't there" into a flag the screens can explain. */
  private async guard<T>(run: () => Promise<T>): Promise<T> {
    try {
      const result = await run();
      this.setupNeeded.set(false);
      return result;
    } catch (err) {
      if (err instanceof ChallengeError && err.kind === 'not-set-up') this.setupNeeded.set(true);
      throw err;
    }
  }

  private async member() {
    const me = await this.identity.me();
    return { playerId: me.id, name: me.name, joinedAt: this.clock.epoch() };
  }
}

/** Home order: what needs doing today, then what's running, then upcoming, then finished. */
function rank({ status }: MyChallenge): number {
  if (status.over) return 3;
  if (status.upcoming) return 2;
  return status.todayDone ? 1 : 0;
}
