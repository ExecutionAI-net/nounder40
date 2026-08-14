import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/api/guards'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// Schools the current user belongs to (multi-school support)
export async function GET() {
  const auth = await requireRole('school')
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('school_memberships')
    .select('school_id, sub_role, schools(id, name, city)')
    .eq('profile_id', auth.user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    activeSchoolId: auth.profile.school_id,
    memberships: (data ?? []).map(m => ({
      school_id: m.school_id,
      sub_role: m.sub_role,
      // supabase-js types joined rows as array; it's a single object here
      school: Array.isArray(m.schools) ? m.schools[0] : m.schools,
    })),
  })
}

// Switch active school (validates membership, then updates profiles.school_id —
// the whole app reads the active school from there)
export async function POST(request: Request) {
  const auth = await requireRole('school')
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { school_id } = await request.json()
  if (!school_id) return NextResponse.json({ error: 'school_id is required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('school_memberships')
    .select('school_id, sub_role')
    .eq('profile_id', auth.user.id)
    .eq('school_id', school_id)
    .single()

  if (!membership) return NextResponse.json({ error: 'not_a_member' }, { status: 403 })

  const { error } = await admin
    .from('profiles')
    .update({ school_id, school_sub_role: membership.sub_role })
    .eq('id', auth.user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
