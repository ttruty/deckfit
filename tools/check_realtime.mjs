/**
 * Checks the Supabase Realtime backend rooms use (CLAUDE.md §3, §7): reachability, channel
 * subscribe, broadcast round trip, presence, and — the one that matters for "room not found" —
 * whether a *second* client sees the first on the same channel.
 *
 * Run: npm run check:realtime            (reads src/environments/environment.local.ts)
 *      SUPABASE_URL=… SUPABASE_KEY=… npm run check:realtime
 *
 * Never prints the key.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const TIMEOUT_MS = 15_000;
const files = ['src/environments/environment.local.ts', 'src/environments/environment.ts'];

function fromEnvironmentFile() {
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const value = (key) => text.match(new RegExp(`${key}\\s*:\\s*['"\`]([^'"\`]*)`))?.[1] ?? '';
    const url = value('supabaseUrl');
    const key = value('supabaseKey');
    if (url && key) return { url, key, source: file };
  }
  return null;
}

const config = process.env['SUPABASE_URL'] && process.env['SUPABASE_KEY']
  ? { url: process.env['SUPABASE_URL'], key: process.env['SUPABASE_KEY'], source: 'environment variables' }
  : fromEnvironmentFile();

const results = [];
const step = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const withTimeout = (promise, ms, what) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms} ms waiting for ${what}`)), ms))]);

if (!config) {
  console.log('FAIL  configuration — no supabaseUrl/supabaseKey found.');
  console.log('      Put them in src/environments/environment.local.ts (gitignored), then run: npm run start:local');
  process.exit(1);
}

const host = (() => {
  try {
    return new URL(config.url).host;
  } catch {
    return config.url;
  }
})();
console.log(`Realtime check for ${host} (from ${config.source})`);
console.log(`Key looks like: ${config.key.slice(0, 3)}… ${config.key.length} chars${config.key.startsWith('eyJ') ? ' (JWT-style anon key)' : ''}`);
if (/service_role/.test(config.key)) console.log('WARNING: that looks like a service-role key — only a publishable/anon key belongs in a browser app.');
console.log('');

const topic = `deckfit:doctor:${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const clients = [];
const newClient = (name) => {
  const client = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  clients.push(client);
  return { client, name };
};

async function main() {
  // 1. The REST endpoint answers (catches a wrong URL or a dead project early).
  try {
    const response = await withTimeout(fetch(`${config.url.replace(/\/$/, '')}/auth/v1/health`, { headers: { apikey: config.key } }), 10_000, 'the REST endpoint');
    step('project reachable', response.ok, `HTTP ${response.status}`);
    if (response.status === 401 || response.status === 403) console.log('      → the key was rejected. Copy the publishable/anon key from Project settings → API keys.');
  } catch (err) {
    step('project reachable', false, err.message);
    console.log('      → check the URL (Project settings → Data API) and that you are online.');
  }

  // 2. Subscribe, 3. broadcast round trip, 4. presence.
  const a = newClient('client A');
  const channelA = a.client.channel(topic, { config: { broadcast: { self: true }, presence: { key: 'doctor-a' } } });
  const gotBroadcast = new Promise((resolve) => channelA.on('broadcast', { event: 'ping' }, (m) => resolve(m.payload)));
  // Resolve only once our own entry shows up: the first sync fires before track() lands.
  const presenceSynced = new Promise((resolve) => {
    channelA.on('presence', { event: 'sync' }, () => {
      const state = channelA.presenceState();
      if (Object.keys(state).includes('doctor-a')) resolve(state);
    });
  });

  try {
    await withTimeout(
      new Promise((resolve, reject) => {
        channelA.subscribe((status, err) => {
          if (status === 'SUBSCRIBED') resolve(status);
          else if (status !== 'CLOSED') reject(err ?? new Error(`channel status ${status}`));
        });
      }),
      TIMEOUT_MS,
      'SUBSCRIBED',
    );
    step('channel subscribe', true, topic);
  } catch (err) {
    step('channel subscribe', false, err.message);
    console.log('      → Realtime may be disabled for the project, or a proxy/firewall is blocking WebSockets.');
    return;
  }

  try {
    await channelA.send({ type: 'broadcast', event: 'ping', payload: { at: Date.now() } });
    await withTimeout(gotBroadcast, TIMEOUT_MS, 'the broadcast to come back');
    step('broadcast round trip', true);
  } catch (err) {
    step('broadcast round trip', false, err.message);
  }

  try {
    await channelA.track({ id: 'doctor-a', since: Date.now() });
    const state = await withTimeout(presenceSynced, TIMEOUT_MS, 'presence sync');
    step('presence', Object.keys(state).length > 0, `${Object.keys(state).length} member(s)`);
  } catch (err) {
    step('presence', false, err.message);
  }

  // 5. The real test: a second client joins and sees the first — this is what "room not found" means.
  const b = newClient('client B');
  const channelB = b.client.channel(topic, { config: { presence: { key: 'doctor-b' } } });
  const sawA = new Promise((resolve) => {
    channelB.on('presence', { event: 'sync' }, () => {
      if (Object.keys(channelB.presenceState()).includes('doctor-a')) resolve(true);
    });
  });
  try {
    await withTimeout(
      new Promise((resolve, reject) => channelB.subscribe((status, err) => (status === 'SUBSCRIBED' ? resolve(status) : status !== 'CLOSED' ? reject(err ?? new Error(status)) : undefined))),
      TIMEOUT_MS,
      'the second client to subscribe',
    );
    await channelB.track({ id: 'doctor-b', since: Date.now() });
    await withTimeout(sawA, TIMEOUT_MS, 'the second client to see the first');
    step('two clients see each other', true, 'a room created in one browser is joinable from another');
  } catch (err) {
    step('two clients see each other', false, err.message);
    console.log('      → joining will fail with "Room not found". Check that Realtime presence/broadcast are enabled for the project.');
  }
}

try {
  await main();
} finally {
  for (const client of clients) await client.removeAllChannels().catch(() => undefined);
  const failed = results.filter((r) => !r.ok);
  console.log('');
  if (failed.length === 0) {
    console.log('All checks passed. Rooms work — serve the app with the local environment: npm run start:local');
  } else {
    console.log(`${failed.length} check(s) failed: ${failed.map((f) => f.name).join(', ')}`);
  }
  process.exit(failed.length ? 1 : 0);
}
