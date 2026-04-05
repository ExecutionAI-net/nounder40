import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/zepto'
import { schoolMemberInviteEmailHtml } from '@/lib/email-templates'

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

const SUB_ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  staff: 'Staff',
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, roles, school_id, school_sub_role')
    .eq('id', user.id)
    .single()

  if (!(profile?.role === 'school' || profile?.roles?.includes('school'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!profile.school_id) {
    return NextResponse.json({ error: 'No school assigned' }, { status: 400 })
  }

  // Only owners can manage team
  if (profile.school_sub_role !== 'owner') {
    return NextResponse.json({ error: 'Only school owners can manage team' }, { status: 403 })
  }

  const db = admin()

  const [{ data: members }, { data: pending }] = await Promise.all([
    db
      .from('profiles')
      .select('id, name, email, school_sub_role, created_at')
      .eq('role', 'school')
      .eq('school_id', profile.school_id)
      .order('created_at', { ascending: false }),
    db
      .from('pending_invitations')
      .select('id, name, email, role_detail, created_at')
      .eq('type', 'school_member')
      .eq('school_id', profile.school_id)
      .order('created_at', { ascending: false }),
  ])

  return NextResponse.json({ active: members ?? [], pending: pending ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: callerProfile } = await supabase
    .from('profiles')
    .select('role, roles, school_id, school_sub_role')
    .eq('id', user.id)
    .single()

  const isSchool = callerProfile?.role === 'school' || callerProfile?.roles?.includes('school')
  if (!isSchool || !callerProfile?.school_id || callerProfile.school_sub_role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden: Only school owners can invite team members' }, { status: 403 })
  }

  const { name, email, school_sub_role } = await request.json()

  if (!name || !email || !school_sub_role) {
    return NextResponse.json({ error: 'name, email and school_sub_role are required' }, { status: 400 })
  }

  if (!['owner', 'admin', 'staff'].includes(school_sub_role)) {
    return NextResponse.json({ error: 'Invalid school_sub_role' }, { status: 400 })
  }

  const db = admin()

  // Look up by email in Supabase Auth
  const { data: authList } = await db.auth.admin.listUsers({ perPage: 1000, page: 1 })
  const authUser = authList?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase())

  if (authUser) {
    // User exists in auth — check if already school member at this school
    const { data: existingProfile } = await db
      .from('profiles')
      .select('id, name, role, roles, school_id')
      .eq('id', authUser.id)
      .single()

    if (existingProfile?.school_id === callerProfile.school_id) {
      return NextResponse.json({ error: 'This email is already a team member at this school' }, { status: 400 })
    }

    // Upsert profile with school role
    const displayName = existingProfile?.name ?? authUser.user_metadata?.name ?? authUser.user_metadata?.full_name ?? name
    const prevRole = existingProfile?.role ?? 'student'
    const prevRoles = existingProfile?.roles ?? (prevRole ? [prevRole] : [])
    const newRoles = Array.from(new Set([...prevRoles, 'school']))

    const { error: upsertError } = await db.from('profiles').upsert(
      {
        id: authUser.id,
        email: authUser.email!,
        name: displayName,
        role: prevRole === 'student' ? 'school' : prevRole,
        roles: newRoles,
        school_id: callerProfile.school_id,
        school_sub_role,
      },
      { onConflict: 'id' }
    )

    if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 })

    // Send notification email
    const { data: school } = await db.from('schools').select('name').eq('id', callerProfile.school_id).single()
    const roleLabel = SUB_ROLE_LABELS[school_sub_role] ?? school_sub_role
    const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL}/school/dashboard`

    sendEmail({
      to: { email, name: displayName },
      subject: `You have been added to ${school?.name} on No Under 40`,
      htmlBody: schoolMemberInviteEmailHtml(displayName, school?.name ?? 'School', dashboardUrl, roleLabel),
    }).catch((err) => {
      console.error('POST /api/school/team (existing user email) error:', err)
    })

    return NextResponse.json({ success: true, existing: true })
  }

  // New user — check not already pending
  const { data: existingPending } = await db
    .from('pending_invitations')
    .select('id')
    .eq('email', email)
    .eq('school_id', callerProfile.school_id)
    .eq('type', 'school_member')
    .single()

  if (existingPending) return NextResponse.json({ error: 'An invitation for this email already exists' }, { status: 400 })

  // Generate magic link
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const { data: schoolData } = await db.from('schools').select('name').eq('id', callerProfile.school_id).single()

  const { data: linkData, error: inviteError } = await db.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: {
      redirectTo: `${appUrl}/setup-account`,
      data: {
        name,
        school_member_invite: true,
        school_id: callerProfile.school_id,
        school_name: schoolData?.name,
        sub_role: school_sub_role,
      },
    },
  })

  if (inviteError || !linkData?.properties?.action_link) {
    return NextResponse.json({ error: inviteError?.message ?? 'Failed to generate invite link' }, { status: 500 })
  }

  const roleLabel = SUB_ROLE_LABELS[school_sub_role] ?? school_sub_role
  sendEmail({
    to: { email, name },
    subject: `You have been invited to ${schoolData?.name} on No Under 40`,
    htmlBody: schoolMemberInviteEmailHtml(name, schoolData?.name ?? 'School', linkData.properties.action_link, roleLabel),
  }).catch((err) => {
    console.error('POST /api/school/team (new user invite) error:', err)
  })

  // Store in pending for UI tracking
  await db.from('pending_invitations').insert({
    type: 'school_member',
    name,
    email,
    role_detail: school_sub_role,
    school_id: callerProfile.school_id,
    invited_by: user.id,
  })

  return NextResponse.json({ success: true, invited: true })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, roles, school_id, school_sub_role')
    .eq('id', user.id)
    .single()

  const isSchool = profile?.role === 'school' || profile?.roles?.includes('school')
  if (!isSchool || !profile?.school_id || profile.school_sub_role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden: Only school owners can remove team members' }, { status: 403 })
  }

  const { id, pending } = await request.json()
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const db = admin()

  if (pending) {
    await db.from('pending_invitations').delete().eq('id', id)
  } else {
    if (id === user.id) return NextResponse.json({ error: 'Cannot remove yourself' }, { status: 400 })

    // Check target is in same school
    const { data: targetProfile } = await db
      .from('profiles')
      .select('school_id, school_sub_role')
      .eq('id', id)
      .single()

    if (targetProfile?.school_id !== profile.school_id) {
      return NextResponse.json({ error: 'Cannot remove team member from different school' }, { status: 403 })
    }

    // Check if user has multiple roles — if so, just remove school role instead of deleting
    const { data: userProfile } = await db.from('profiles').select('roles, role').eq('id', id).single()
    const roles: string[] = userProfile?.roles ?? (userProfile?.role ? [userProfile.role] : [])
    const remainingRoles = roles.filter((r) => r !== 'school')

    if (remainingRoles.length > 0) {
      // User has other roles — demote from school
      await db.from('profiles').update({
        role: remainingRoles[0] as 'student' | 'teacher' | 'hq',
        roles: remainingRoles,
        school_id: null,
        school_sub_role: null,
      }).eq('id', id)
    } else {
      // School-only user — delete entirely
      await db.auth.admin.deleteUser(id)
      await db.from('profiles').delete().eq('id', id)
    }
  }

  return NextResponse.json({ success: true })
}
