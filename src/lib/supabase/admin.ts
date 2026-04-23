import { createClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase client. Bypasses RLS.
 *
 * Use ONLY from server-side code (API routes, Server Actions, Edge Functions).
 * Never import this into a client component — the key would ship to the browser.
 *
 * Scope this narrowly: a single counter update, a trusted-system write.
 * For anything touching user data, prefer the user-session client in server.ts
 * so RLS remains in effect.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
