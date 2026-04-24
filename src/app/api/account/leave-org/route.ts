import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Remove the caller's membership in a specific organization type.
 * Body: { org: 'hq' | 'school' }
 *
 * - 'hq' → removes 'hq' from roles[], clears hq_sub_role
 * - 'school' → removes 'school' from roles[], clears school_id + school_sub_role
 *
 * If removing this role leaves the user with NO roles at all, the API will
 * also soft-delete their profile (sets deleted_at) so they can't keep an
 * empty account around.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { org } = await request.json()
  if (org !== 'hq' && org !== 'school') {
    return NextResponse.json({ error: 'org must be "hq" or "school"' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: profile, error: pErr } = await admin
    .from('profiles')
    .select('roles, role, hq_sub_role, school_sub_role, school_id')
    .eq('id', user.id)
    .single()
  if (pErr || !profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  const currentRoles: string[] = profile.roles?.length ? profile.roles : (profile.role ? [profile.role] : [])
  if (!currentRoles.includes(org)) {
    return NextResponse.json({ error: `You are not a member of ${org}` }, { status: 400 })
  }

  const remainingRoles = currentRoles.filter(r => r !== org)
  const update: Record<string, unknown> = { roles: remainingRoles }

  if (org === 'hq') {
    update.hq_sub_role = null
  } else {
    update.school_sub_role = null
    update.school_id = null
  }

  // Pick a fallback primary role so `profiles.role` isn't the one we just removed
  if (remainingRoles.length > 0) {
    update.role = remainingRoles[0]
  } else {
    // No roles left → soft delete so middleware bounces them on next request
    update.deleted_at = new Date().toISOString()
  }

  const { error: updateErr } = await admin
    .from('profiles')
    .update(update)
    .eq('id', user.id)

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  // If fully deleted, also sign them out globally
  if (remainingRoles.length === 0) {
    await admin.auth.admin.signOut(user.id, 'global').catch(() => {})
  }

  return NextResponse.json({
    left: org,
    remaining_roles: remainingRoles,
    account_deleted: remainingRoles.length === 0,
  })
}
