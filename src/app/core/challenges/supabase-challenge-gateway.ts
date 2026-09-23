import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { Challenge, ChallengeDay, ChallengeMember, ChallengeState } from '../../domain/models/challenge.schema';
import { ChallengeError, newChallengeCode, parse, type ChallengeGateway, type NewChallenge } from './challenge-gateway';

/**
 * "The table isn't there" — i.e. the migration hasn't been run. Postgres says 42P01, but
 * PostgREST usually answers from its schema cache first (PGRST205 and friends), so both count.
 */
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42P01' || !!error.code?.startsWith('PGRST2') || !!error.message?.includes('schema cache');
}

interface ChallengeRow {
  id: string;
  code: string;
  name: string;
  goal: unknown;
  ante: number;
  starts_on: string;
  ends_on: string;
  created_by: string;
  created_at: string;
}

function toChallenge(row: ChallengeRow): Challenge {
  return parse.challenge({
    id: row.id,
    code: row.code,
    name: row.name,
    goal: row.goal,
    ante: row.ante,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    createdBy: row.created_by,
    createdAt: Date.parse(row.created_at) || 0,
  });
}

/**
 * Challenges in Supabase (§7b, `supabase/migrations/0001_challenges.sql`). Every row is
 * Zod-validated on the way in: it is public data written by other people's devices.
 *
 * The client carries `x-device-id`, which the row policies check — accident prevention for
 * anonymous devices, not proof (§7 trust model).
 */
export class SupabaseChallengeGateway implements ChallengeGateway {
  private readonly channels = new Map<string, RealtimeChannel>();

  constructor(private readonly client: SupabaseClient) {}

  async create(input: NewChallenge, me: ChallengeMember): Promise<Challenge> {
    // A code clash is possible but rare; try a few before giving up.
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data, error } = await this.client
        .from('challenges')
        .insert({
          code: newChallengeCode(),
          name: input.name,
          goal: input.goal,
          ante: input.ante,
          starts_on: input.startsOn,
          ends_on: input.endsOn,
          created_by: me.playerId,
        })
        .select()
        .single();
      if (!error) {
        const challenge = toChallenge(data as ChallengeRow);
        await this.join(challenge.id, me);
        return challenge;
      }
      if (isMissingTable(error)) throw notSetUp();
      if (error.code !== '23505') throw new ChallengeError(error.message); // unique violation → new code
    }
    throw new ChallengeError('Could not find a free challenge code. Try again.');
  }

  async byCode(code: string): Promise<ChallengeState | null> {
    const { data, error } = await this.client.from('challenges').select().eq('code', code.toUpperCase()).maybeSingle();
    if (error) throw isMissingTable(error) ? notSetUp() : new ChallengeError(error.message);
    if (!data) return null;
    const challenge = toChallenge(data as ChallengeRow);

    const [members, days] = await Promise.all([
      this.client.from('challenge_members').select().eq('challenge_id', challenge.id),
      this.client.from('challenge_days').select().eq('challenge_id', challenge.id),
    ]);
    if (members.error) throw isMissingTable(members.error) ? notSetUp() : new ChallengeError(members.error.message);
    if (days.error) throw isMissingTable(days.error) ? notSetUp() : new ChallengeError(days.error.message);

    return {
      challenge,
      members: (members.data ?? []).map((row: { player_id: string; name: string; joined_at: string }) =>
        parse.member({ playerId: row.player_id, name: row.name, joinedAt: Date.parse(row.joined_at) || 0 }),
      ),
      days: (days.data ?? []).map((row: { player_id: string; day: string; points: number; workouts: number }) =>
        parse.day({ playerId: row.player_id, day: row.day, points: row.points, workouts: row.workouts }),
      ),
    };
  }

  async join(challengeId: string, me: ChallengeMember): Promise<void> {
    const { error } = await this.client
      .from('challenge_members')
      .upsert({ challenge_id: challengeId, player_id: me.playerId, name: me.name }, { onConflict: 'challenge_id,player_id' });
    if (error) throw isMissingTable(error) ? notSetUp() : new ChallengeError(error.message);
  }

  async leave(challengeId: string, playerId: string): Promise<void> {
    const { error } = await this.client
      .from('challenge_members')
      .delete()
      .eq('challenge_id', challengeId)
      .eq('player_id', playerId);
    if (error) throw new ChallengeError(error.message);
  }

  async reportDays(challengeId: string, days: readonly ChallengeDay[]): Promise<void> {
    if (!days.length) return;
    const { error } = await this.client.from('challenge_days').upsert(
      days.map((d) => ({
        challenge_id: challengeId,
        player_id: d.playerId,
        day: d.day,
        points: d.points,
        workouts: d.workouts,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: 'challenge_id,player_id,day' },
    );
    if (error) throw isMissingTable(error) ? notSetUp() : new ChallengeError(error.message);
  }

  async mine(playerId: string): Promise<Challenge[]> {
    const seats = await this.client.from('challenge_members').select('challenge_id').eq('player_id', playerId);
    if (seats.error) throw isMissingTable(seats.error) ? notSetUp() : new ChallengeError(seats.error.message);
    const ids = (seats.data ?? []).map((row: { challenge_id: string }) => row.challenge_id);
    if (!ids.length) return [];
    const { data, error } = await this.client.from('challenges').select().in('id', ids).order('created_at', { ascending: false });
    if (error) throw new ChallengeError(error.message);
    return (data ?? []).map((row) => toChallenge(row as ChallengeRow));
  }

  watch(challengeId: string, onChange: () => void): () => void {
    const channel = this.client
      .channel(`deckfit:challenge:${challengeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'challenge_days', filter: `challenge_id=eq.${challengeId}` }, () => onChange())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'challenge_members', filter: `challenge_id=eq.${challengeId}` }, () => onChange())
      .subscribe();
    this.channels.set(challengeId, channel);
    return () => {
      this.channels.delete(challengeId);
      void this.client.removeChannel(channel);
    };
  }
}

function notSetUp(): ChallengeError {
  return new ChallengeError(
    'Challenges need one database migration on your Supabase project: run supabase/migrations/0001_challenges.sql.',
    'not-set-up',
  );
}
