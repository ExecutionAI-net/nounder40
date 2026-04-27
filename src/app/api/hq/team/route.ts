import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/zepto'
import { hqInviteEmailHtml, hqInviteNewUserEmailHtml } from '@/lib/email-templates'

export const dynamic = 'force-dynamic'

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

const SUB_ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  super_admin: 'Super Admin',
  operations: 'Operations',
  tech_support: 'Tech Support',
  analytics: 'Analytics',
  support: 'Support',
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, roles').eq('id', user.id).single()
  if (!(profile?.role === 'hq' || profile?.roles?.includes('hq'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = admin()

  const [{ data: members }, { data: pending }] = await Promise.all([
    db.from('profiles').select('id, name, email, hq_sub_role, created_at')
      .eq('role', 'hq').order('created_at', { ascending: false }),
    db.from('pending_invitations').select('id, name, email, role_detail, created_at')
      .eq('type', 'hq_member').order('created_at', { ascending: false }),
  ])

  const { data: callerProfile } = await supabase.from('profiles').select('hq_sub_role').eq('id', user.id).single()

  return NextResponse.json({ active: members ?? [], pending: pending ?? [], callerSubRole: callerProfile?.hq_sub_role ?? null })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: callerProfile } = await supabase.from('profiles').select('role, roles, hq_sub_role').eq('id', user.id).single()
  const callerSubRole = callerProfile?.hq_sub_role
  const isHQ = callerProfile?.role === 'hq' || callerProfile?.roles?.includes('hq')
  if (!isHQ || (callerSubRole !== 'owner' && callerSubRole !== 'super_admin')) {
    return NextResponse.json({ error: 'Forbidden: Super Admin or Owner only' }, { status: 403 })
  }

  const { name, email, hq_sub_role } = await request.json()

  if (hq_sub_role === 'owner' && callerSubRole !== 'owner') {
    return NextResponse.json({ error: 'Only Owner can assign Owner role' }, { status: 403 })
  }
  if (!name || !email || !hq_sub_role) {
    return NextResponse.json({ error: 'name, email and hq_sub_role are required' }, { status: 400 })
  }

  const db = admin()

  // Look up by email in Supabase Auth (most reliable — works even if profiles.email is null)
  const { data: authList } = await db.auth.admin.listUsers({ perPage: 1000, page: 1 })
  const authUser = authList?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase())

  if (authUser) {
    // User exists in auth — check if already HQ
    const { data: existingProfile } = await db.from('profiles').select('id, name, role').eq('id', authUser.id).single()

    if (existingProfile?.role === 'hq') {
      return NextResponse.json({ error: 'This email is already an HQ member' }, { status: 400 })
    }

    // Upsert profile with HQ role and update roles array atomically
    const displayName = existingProfile?.name ?? authUser.user_metadata?.name ?? authUser.user_metadata?.full_name ?? name
    const prevRole = existingProfile?.role ?? 'student'
    const newRoles = [prevRole, 'hq'].filter((v, i, a) => v && a.indexOf(v) === i)
    const { error: upsertError } = await db.from('profiles').upsert({
      id: authUser.id,
      email: authUser.email!,
      name: displayName,
      role: 'hq',
      hq_sub_role,
      roles: newRoles,
    }, { onConflict: 'id' })

    if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 })

    // Send notification email
    const roleLabel = SUB_ROLE_LABELS[hq_sub_role] ?? hq_sub_role
    const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL}/hq/dashboard`
    sendEmail({
      to: { email, name: displayName },
      subject: 'You have been added to the No Under 40 HQ Panel',
      htmlBody: hqInviteEmailHtml(displayName, dashboardUrl, roleLabel),
    }).catch(() => {})

    return NextResponse.json({ success: true, existing: true })
  }

  // New user — check not already pending
  const { data: existingPending } = await db.from('pending_invitations').select('id').eq('email', email).single()
  if (existingPending) return NextResponse.json({ error: 'An invitation for this email already exists' }, { status: 400 })

  // Generate magic link (new user with preset password flow), then send our own branded email (suppress Supabase default)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const { data: linkData, error: inviteError } = await db.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: {
      redirectTo: `${appUrl}/setup-account`,
      data: { name, hq_sub_role, hq_member_invite: true },
    },
  })

  if (inviteError || !linkData?.properties?.action_link) {
    return NextResponse.json({ error: inviteError?.message ?? 'Failed to generate invite link' }, { status: 500 })
  }

  const roleLabel = SUB_ROLE_LABELS[hq_sub_role] ?? hq_sub_role
  sendEmail({
    to: { email, name },
    subject: `You have been invited to No Under 40`,
    htmlBody: hqInviteNewUserEmailHtml(name, linkData.properties.action_link, roleLabel),
  }).catch(() => {})

  // Store in pending for UI tracking
  await db.from('pending_invitations').insert({
    type: 'hq_member',
    name,
    email,
    role_detail: hq_sub_role,
    invited_by: user.id,
  })

  return NextResponse.json({ success: true, invited: true })
}

export async function PUT(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: callerProfile } = await supabase.from('profiles').select('role, roles, hq_sub_role').eq('id', user.id).single()
  const callerSubRole = callerProfile?.hq_sub_role
  const isHQ = callerProfile?.role === 'hq' || callerProfile?.roles?.includes('hq')

  if (!isHQ || callerSubRole !== 'owner') {
    return NextResponse.json({ error: 'Forbidden: Only Owner can change roles' }, { status: 403 })
  }

  const { id, hq_sub_role } = await request.json()

  if (!id || !hq_sub_role) {
    return NextResponse.json({ error: 'id and hq_sub_role are required' }, { status: 400 })
  }

  if (!['owner', 'super_admin', 'operations', 'tech_support', 'analytics', 'support'].includes(hq_sub_role)) {
    return NextResponse.json({ error: 'Invalid hq_sub_role' }, { status: 400 })
  }

  const db = admin()

  // Cannot change owner role
  if (hq_sub_role === 'owner') {
    return NextResponse.json({ error: 'Cannot change role to Owner' }, { status: 403 })
  }

  // Get target member
  const { data: targetProfile, error: fetchError } = await db.from('profiles').select('hq_sub_role').eq('id', id).single()
  if (fetchError || !targetProfile) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  // Cannot change owner's role
  if (targetProfile.hq_sub_role === 'owner') {
    return NextResponse.json({ error: 'Cannot change Owner role' }, { status: 403 })
  }

  // Update role
  const { error: updateError } = await db.from('profiles').update({ hq_sub_role }).eq('id', id)
  if (updateError) {
    console.error('PUT /api/hq/team update error:', updateError.message)
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, roles, hq_sub_role').eq('id', user.id).single()
  const callerSubRole = profile?.hq_sub_role
  const isHQ = profile?.role === 'hq' || profile?.roles?.includes('hq')
  if (!isHQ || (callerSubRole !== 'owner' && callerSubRole !== 'super_admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id, pending } = await request.json()
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const db = admin()

  if (pending) {
    await db.from('pending_invitations').delete().eq('id', id)
  } else {
    if (id === user.id) return NextResponse.json({ error: 'Cannot remove yourself' }, { status: 400 })

    // Super admin cannot remove owners or other super admins
    if (callerSubRole === 'super_admin') {
      const { data: targetProfile } = await db.from('profiles').select('hq_sub_role').eq('id', id).single()
      if (targetProfile?.hq_sub_role === 'owner' || targetProfile?.hq_sub_role === 'super_admin') {
        return NextResponse.json({ error: 'Super Admin cannot remove Owner or other Super Admins' }, { status: 403 })
      }
    }

    // Check if user has multiple roles — if so, just remove HQ role instead of deleting
    const { data: targetProfile } = await db.from('profiles').select('roles, role').eq('id', id).single()
    const roles: string[] = targetProfile?.roles ?? ['hq']
    const remainingRoles = roles.filter((r) => r !== 'hq')

    if (remainingRoles.length > 0) {
      // User has other roles — demote from HQ
      await db.from('profiles').update({
        role: remainingRoles[0] as 'student' | 'teacher' | 'school',
        roles: remainingRoles,
        hq_sub_role: null,
      }).eq('id', id)
    } else {
      // HQ-only user — delete entirely
      await db.auth.admin.deleteUser(id)
      await db.from('profiles').delete().eq('id', id)
    }
  }

  return NextResponse.json({ success: true })
}
