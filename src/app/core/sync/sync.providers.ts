import { InjectionToken, inject } from '@angular/core';
import { createClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { LoopbackHub, LoopbackTransport } from './loopback-transport';
import { REALTIME_CONFIGURED } from './realtime-config';
import { SupabaseTransport, supabaseRealtime } from './supabase-transport';
import type { SyncTransport } from './sync-transport';

/** The in-memory network used when no realtime backend is configured. */
export const LOOPBACK_HUB = new InjectionToken<LoopbackHub>('LOOPBACK_HUB', {
  providedIn: 'root',
  factory: () => new LoopbackHub(),
});

/**
 * Creates a transport for one room connection. Uses Supabase Realtime when the environment
 * has `supabaseUrl` + `supabaseKey`, otherwise the in-memory loopback. Nothing outside
 * core/sync knows which is in use. (Only lazy room features import this file, so the
 * Supabase client stays out of the initial bundle.)
 */
export const SYNC_TRANSPORT_FACTORY = new InjectionToken<() => SyncTransport>('SYNC_TRANSPORT_FACTORY', {
  providedIn: 'root',
  factory: () => {
    const { supabaseUrl, supabaseKey } = environment;
    if (inject(REALTIME_CONFIGURED)) {
      // One client for the app: realtime only, no auth session persistence.
      const client = createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const realtime = supabaseRealtime(client);
      return () => new SupabaseTransport(realtime);
    }
    const hub = inject(LOOPBACK_HUB);
    return () => new LoopbackTransport(hub);
  },
});
