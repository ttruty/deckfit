import { InjectionToken, inject } from '@angular/core';
import { createClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { REALTIME_CONFIGURED } from '../sync/realtime-config';
import { MemoryChallengeGateway, type ChallengeGateway } from './challenge-gateway';
import { SupabaseChallengeGateway } from './supabase-challenge-gateway';

/** Kept app-wide so a challenge made with no backend survives a navigation (like LOOPBACK_HUB). */
const MEMORY_GATEWAY = new InjectionToken<MemoryChallengeGateway>('MEMORY_CHALLENGE_GATEWAY', {
  providedIn: 'root',
  factory: () => new MemoryChallengeGateway(),
});

/**
 * Builds the gateway for this device (§7b). Supabase when the environment has a URL + key,
 * otherwise this browser's memory — challenges then work but reach nobody else, and the screens
 * say so. Only lazy challenge features import this, so supabase-js stays out of the first load.
 *
 * The device id goes in a header the row policies check; it identifies, it doesn't prove (§7).
 */
export const CHALLENGE_GATEWAY_FACTORY = new InjectionToken<(deviceId: string) => ChallengeGateway>(
  'CHALLENGE_GATEWAY_FACTORY',
  {
    providedIn: 'root',
    factory: () => {
      const configured = inject(REALTIME_CONFIGURED);
      const memory = inject(MEMORY_GATEWAY);
      const clients = new Map<string, ChallengeGateway>();
      return (deviceId: string) => {
        if (!configured) return memory;
        const existing = clients.get(deviceId);
        if (existing) return existing;
        const client = createClient(environment.supabaseUrl, environment.supabaseKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          global: { headers: { 'x-device-id': deviceId } },
        });
        const gateway = new SupabaseChallengeGateway(client);
        clients.set(deviceId, gateway);
        return gateway;
      };
    },
  },
);
