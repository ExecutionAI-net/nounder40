import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, roles, hq_sub_role').eq('id', user.id).single()
  if (!(profile?.role === 'hq' || profile?.roles?.includes('hq')) || profile?.hq_sub_role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden: Super Admin only' }, { status: 403 })
  }

  const { id, password } = await request.json()
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const db = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: invite } = await db.from('pending_invitations').select('*').eq('id', id).eq('type', 'hq_member').single()
  if (!invite) return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })

  // Check if user already exists in auth by email
  const { data: existingProfile } = await db.from('profiles').select('id, roles, role').eq('email', invite.email).single()

  if (existingProfile) {
    // User already exists — just grant HQ access
    const currentRoles: string[] = existingProfile.roles?.length ? existingProfile.roles : [existingProfile.role]
    const updatedRoles = Array.from(new Set([...currentRoles, 'hq']))

    await db.from('profiles').update({
      role: 'hq',
      roles: updatedRoles,
      hq_sub_role: invite.role_detail,
    }).eq('id', existingProfile.id)

    // Update password if provided
    if (password && password.length >= 8) {
      await db.auth.admin.updateUserById(existingProfile.id, { password })
    }
  } else {
    // Create new user
    if (!password || password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    const { data: userData, error: createError } = await db.auth.admin.createUser({
      email: invite.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: invite.name, role: 'hq' },
    })

    if (createError) return NextResponse.json({ error: createError.message }, { status: 500 })

    await db.from('profiles').upsert({
      id: userData.user.id,
      email: invite.email,
      name: invite.name,
      role: 'hq',
      roles: ['hq'],
      hq_sub_role: invite.role_detail,
    })
  }

  await db.from('pending_invitations').delete().eq('id', id)

  return NextResponse.json({ success: true })
}
