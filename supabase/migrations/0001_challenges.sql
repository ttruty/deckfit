-- DeckFit §7b — async challenges.
--
-- Rooms (§7) are live and hold nothing: a room exists while somebody is connected. A challenge
-- runs for days, so it needs a place to sit. These three tables are the only server-side state
-- in the app; the rules engine still runs on devices.
--
-- Trust model: devices are anonymous (§7). The device id travels in the `x-device-id` header and
-- the policies below use it, which stops a client writing someone else's row *by accident* — it
-- is not proof of identity, because a client can send any header. Anyone with the six-character
-- code can read and take part, exactly like a room code. To make this real, turn on Supabase
-- anonymous auth and swap `device_id()` for `auth.uid()`.
--
-- Run it with the Supabase CLI (`supabase db push`) or paste it into the SQL editor.

create extension if not exists pgcrypto;

-- The device that sent the request, as it declares itself.
create or replace function public.device_id() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.headers', true)::json ->> 'x-device-id', ''), '-')
$$;

create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  name text not null check (char_length(name) between 1 and 60),
  -- ChallengeGoal (domain/models/challenge.schema.ts): {kind:'streak'} | {kind:'daily',points} | {kind:'total',points}
  goal jsonb not null,
  -- Reps each player puts on the line per day.
  ante integer not null check (ante between 1 and 500),
  starts_on date not null,
  ends_on date not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  constraint challenge_window check (ends_on >= starts_on and ends_on < starts_on + interval '180 days')
);

create table if not exists public.challenge_members (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  player_id text not null,
  name text not null check (char_length(name) between 1 and 40),
  joined_at timestamptz not null default now(),
  primary key (challenge_id, player_id)
);

-- One row per player per local day: the day is the player's own calendar day, not the server's.
create table if not exists public.challenge_days (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  player_id text not null,
  day date not null,
  points integer not null default 0 check (points >= 0),
  workouts integer not null default 0 check (workouts >= 0),
  updated_at timestamptz not null default now(),
  primary key (challenge_id, player_id, day)
);

create index if not exists challenge_members_player on public.challenge_members (player_id);
create index if not exists challenge_days_challenge on public.challenge_days (challenge_id);

alter table public.challenges enable row level security;
alter table public.challenge_members enable row level security;
alter table public.challenge_days enable row level security;

-- Readable by anyone who can reach the row (you need the code to find it).
drop policy if exists challenges_read on public.challenges;
create policy challenges_read on public.challenges for select to anon using (true);

drop policy if exists challenges_create on public.challenges;
create policy challenges_create on public.challenges for insert to anon
  with check (created_by = public.device_id());

drop policy if exists members_read on public.challenge_members;
create policy members_read on public.challenge_members for select to anon using (true);

drop policy if exists members_join on public.challenge_members;
create policy members_join on public.challenge_members for insert to anon
  with check (player_id = public.device_id());

drop policy if exists members_rename on public.challenge_members;
create policy members_rename on public.challenge_members for update to anon
  using (player_id = public.device_id()) with check (player_id = public.device_id());

drop policy if exists members_leave on public.challenge_members;
create policy members_leave on public.challenge_members for delete to anon
  using (player_id = public.device_id());

drop policy if exists days_read on public.challenge_days;
create policy days_read on public.challenge_days for select to anon using (true);

-- You may only report your own days, and only for a challenge you have joined.
drop policy if exists days_report on public.challenge_days;
create policy days_report on public.challenge_days for insert to anon
  with check (
    player_id = public.device_id()
    and exists (
      select 1 from public.challenge_members m
      where m.challenge_id = challenge_days.challenge_id and m.player_id = public.device_id()
    )
  );

drop policy if exists days_update on public.challenge_days;
create policy days_update on public.challenge_days for update to anon
  using (player_id = public.device_id()) with check (player_id = public.device_id());

-- Live updates while a screen is open.
alter publication supabase_realtime add table public.challenge_members;
alter publication supabase_realtime add table public.challenge_days;
