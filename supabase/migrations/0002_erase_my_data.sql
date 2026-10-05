-- DeckFit §7b — "Erase everything on this device" (§10) needs to reach the server too.
--
-- 0001 lets a device join, report its own days and leave, but never delete the day rows it
-- reported: a device that erased itself left its numbers behind in every challenge it had been
-- in. This adds the missing policy, so an erase can take the device's own rows with it.
--
-- Only your own rows, and only the ones you wrote: the same `device_id()` rule as everywhere
-- else (which identifies, it does not prove — §7). The challenge itself is never deleted, nor
-- are anyone else's days: other people are still in it, and their work is theirs.
--
-- Run it with the Supabase CLI (`supabase db push`) or paste it into the SQL editor. Until it
-- has been run, an erase still clears the device; the server keeps the old day rows and the app
-- says so.

drop policy if exists days_erase on public.challenge_days;
create policy days_erase on public.challenge_days for delete to anon
  using (player_id = public.device_id());
