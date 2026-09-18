import { InjectionToken } from '@angular/core';
import { environment } from '../../../environments/environment';

/**
 * Whether a realtime backend is configured (§3). False → rooms use the in-memory
 * LoopbackTransport, so they exist only in this browser: another device or browser joining the
 * code gets "Room not found". Screens that offer rooms say so. Kept free of the Supabase client
 * so any screen can read it without pulling the vendor code into its chunk.
 */
export const REALTIME_CONFIGURED = new InjectionToken<boolean>('REALTIME_CONFIGURED', {
  providedIn: 'root',
  factory: () => !!environment.supabaseUrl && !!environment.supabaseKey,
});
