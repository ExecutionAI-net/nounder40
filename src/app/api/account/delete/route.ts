import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Soft-delete the caller's profile.
 *   - Sets profiles.deleted_at = NOW()
 *   - Signs out the user globally
 *   - Middleware blocks any future request that carries a session whose
 *     profile row has deleted_at set.
 *
 * Body: { confirmation: 'delete my account' }  (case-insensitive)
 *
 * Auth row in auth.users is left intact for 30 days so a support flow can
 * restore the account if the user regrets.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { confirmation } = await request.json()
  if (typeof confirmation !== 'string' || confirmation.trim().toLowerCase() !== 'delete my account') {
    return NextResponse.json({ error: 'Please type "delete my account" to confirm' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('profiles')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', user.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Sign the user out of every session
  await admin.auth.admin.signOut(user.id, 'global').catch(() => {})

  return NextResponse.json({ deleted: true })
}
