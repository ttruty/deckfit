import {
  ChallengeDaySchema, ChallengeMemberSchema, ChallengeSchema,
  type Challenge, type ChallengeDay, type ChallengeGoal, type ChallengeMember, type ChallengeState,
} from '../../domain/models/challenge.schema';

export interface NewChallenge {
  name: string;
  goal: ChallengeGoal;
  ante: number;
  startsOn: string;
  endsOn: string;
}

export class ChallengeError extends Error {
  constructor(message: string, readonly kind: 'not-found' | 'no-backend' | 'not-set-up' | 'failed' = 'failed') {
    super(message);
    this.name = 'ChallengeError';
  }
}

/**
 * Everything a challenge needs from storage (§7b). Behind an interface so the screens never
 * know whether that's Supabase or, with no backend configured, this device's memory — and so
 * tests can drive several devices against one fake.
 */
export interface ChallengeGateway {
  create(input: NewChallenge, me: ChallengeMember): Promise<Challenge>;
  /** Everything about one challenge, or null when the code is unknown. */
  byCode(code: string): Promise<ChallengeState | null>;
  /** Idempotent: joining twice keeps one seat, and updates the name. */
  join(challengeId: string, me: ChallengeMember): Promise<void>;
  leave(challengeId: string, playerId: string): Promise<void>;
  /** Upserts this device's own day rows. */
  reportDays(challengeId: string, days: readonly ChallengeDay[]): Promise<void>;
  /** Challenges this device has joined, newest first. */
  mine(playerId: string): Promise<Challenge[]>;
  /** Calls back when anything in the challenge changes; returns an unsubscribe. */
  watch(challengeId: string, onChange: () => void): () => void;
}

/** Six unambiguous characters, like a room code. */
export function newChallengeCode(random: () => number = Math.random): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  return Array.from({ length: 6 }, () => alphabet[Math.floor(random() * alphabet.length)]).join('');
}

/** Validates a row coming back from storage: it is public data, never trusted as typed. */
export const parse = {
  challenge: (row: unknown): Challenge => ChallengeSchema.parse(row),
  member: (row: unknown): ChallengeMember => ChallengeMemberSchema.parse(row),
  day: (row: unknown): ChallengeDay => ChallengeDaySchema.parse(row),
};

/**
 * In-memory stand-in used when no backend is configured (and by tests). A challenge lives only
 * in this browser, exactly like a loopback room — the screens say so.
 */
export class MemoryChallengeGateway implements ChallengeGateway {
  private readonly challenges = new Map<string, Challenge>();
  private readonly members = new Map<string, ChallengeMember[]>();
  private readonly days = new Map<string, ChallengeDay[]>();
  private readonly watchers = new Map<string, Set<() => void>>();
  private now = 1;

  async create(input: NewChallenge, me: ChallengeMember): Promise<Challenge> {
    const challenge: Challenge = {
      id: `challenge-${this.challenges.size + 1}`,
      code: newChallengeCode(),
      createdBy: me.playerId,
      createdAt: this.now++,
      ...input,
    };
    this.challenges.set(challenge.id, ChallengeSchema.parse(challenge));
    this.members.set(challenge.id, [me]);
    this.days.set(challenge.id, []);
    return challenge;
  }

  async byCode(code: string): Promise<ChallengeState | null> {
    const challenge = [...this.challenges.values()].find((c) => c.code === code.toUpperCase());
    if (!challenge) return null;
    return {
      challenge,
      members: [...(this.members.get(challenge.id) ?? [])],
      days: [...(this.days.get(challenge.id) ?? [])],
    };
  }

  async join(challengeId: string, me: ChallengeMember): Promise<void> {
    const seats = this.members.get(challengeId) ?? [];
    const without = seats.filter((m) => m.playerId !== me.playerId);
    const existing = seats.find((m) => m.playerId === me.playerId);
    this.members.set(challengeId, [...without, { ...me, joinedAt: existing?.joinedAt ?? this.now++ }]);
    this.changed(challengeId);
  }

  async leave(challengeId: string, playerId: string): Promise<void> {
    this.members.set(challengeId, (this.members.get(challengeId) ?? []).filter((m) => m.playerId !== playerId));
    this.changed(challengeId);
  }

  async reportDays(challengeId: string, days: readonly ChallengeDay[]): Promise<void> {
    if (!days.length) return;
    const rows = this.days.get(challengeId) ?? [];
    const keep = rows.filter((row) => !days.some((d) => d.playerId === row.playerId && d.day === row.day));
    this.days.set(challengeId, [...keep, ...days.map((d) => ChallengeDaySchema.parse(d))]);
    this.changed(challengeId);
  }

  async mine(playerId: string): Promise<Challenge[]> {
    return [...this.challenges.values()]
      .filter((c) => (this.members.get(c.id) ?? []).some((m) => m.playerId === playerId))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  watch(challengeId: string, onChange: () => void): () => void {
    const set = this.watchers.get(challengeId) ?? new Set();
    set.add(onChange);
    this.watchers.set(challengeId, set);
    return () => set.delete(onChange);
  }

  private changed(challengeId: string): void {
    for (const cb of this.watchers.get(challengeId) ?? []) cb();
  }
}
