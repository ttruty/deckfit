/**
 * Committed defaults: no realtime backend, so rooms use the in-memory LoopbackTransport.
 * Real keys go in environment.local.ts (gitignored), used by the `local` build/serve
 * configuration (`npm run start:local`, `npm run e2e`). See CLAUDE.md §3.
 */
export const environment = {
  supabaseUrl: '',
  /** Publishable (anon) key only — never a secret/service-role key; it ships to browsers. */
  supabaseKey: '',
};
