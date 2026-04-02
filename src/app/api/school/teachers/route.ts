import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/zepto'
import { teacherInviteEmailHtml } from '@/lib/email-templates'

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, school_id').eq('id', user.id).single()
  if (profile?.role !== 'school' || !profile.school_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = admin()

  const [{ data: teachers, error }, { data: pending }] = await Promise.all([
    db.from('teacher_schools')
      .select('teacher_id, active, teachers(id, name, email, phone, active, created_at), compensation_plans(id, name)')
      .eq('school_id', profile.school_id)
      .order('teacher_id'),
    db.from('pending_invitations')
      .select('id, name, email, phone, created_at')
      .eq('type', 'school_teacher')
      .eq('school_id', profile.school_id)
      .order('created_at', { ascending: false }),
  ])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ teachers: teachers ?? [], pending: pending ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, school_id').eq('id', user.id).single()
  if (profile?.role !== 'school' || !profile.school_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { name, email, phone } = await request.json()
  if (!name || !email) return NextResponse.json({ error: 'name and email are required' }, { status: 400 })

  const db = admin()

  // Check duplicates
  const { data: existingPending } = await db.from('pending_invitations').select('id').eq('email', email).single()
  if (existingPending) return NextResponse.json({ error: 'An invitation for this email already exists' }, { status: 400 })

  // Get school name for email
  const { data: school } = await db.from('schools').select('name').eq('id', profile.school_id).single()
  const schoolName = school?.name ?? 'the school'

  // Save to pending_invitations
  const { error } = await db.from('pending_invitations').insert({
    type: 'school_teacher',
    name,
    email,
    phone: phone || null,
    school_id: profile.school_id,
    invited_by: user.id,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://nounder40-n48u-five.vercel.app'

  // Check if user already exists
  const { data: existingProfile } = await db.from('profiles').select('id, roles, role').eq('email', email).single()

  let inviteLink: string | null = null

  if (existingProfile) {
    // Existing user: set up teacher record immediately, send magic link
    const userId = existingProfile.id

    let teacherId: string | null = null
    const { data: existingTeacher } = await db.from('teachers').select('id').eq('email', email).single()
    if (existingTeacher) {
      teacherId = existingTeacher.id
      await db.from('teachers').update({ user_id: userId, active: true }).eq('id', teacherId)
    } else {
      const { data: newTeacher } = await db.from('teachers').insert({ user_id: userId, name, email, active: true }).select('id').single()
      teacherId = newTeacher?.id ?? null
    }

    if (teacherId) {
      await db.from('teacher_schools').upsert(
        { teacher_id: teacherId, school_id: profile.school_id, active: true },
        { onConflict: 'teacher_id,school_id' }
      )
    }

    const currentRoles: string[] = existingProfile.roles?.length ? existingProfile.roles : (existingProfile.role ? [existingProfile.role] : [])
    await db.from('profiles').update({
      roles: Array.from(new Set([...currentRoles, 'teacher'])),
    }).eq('id', userId)

    await db.from('pending_invitations').delete().eq('email', email)

    const { data: magicData } = await db.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: `${appUrl}/setup-account` },
    })
    inviteLink = magicData?.properties.action_link ?? null
  } else {
    // New user: generate invite link with metadata
    const { data: linkData } = await db.auth.admin.generateLink({
      type: 'invite',
      email,
      options: {
        redirectTo: `${appUrl}/auth/callback`,
        data: { teacher_invite: true, school_id: profile.school_id, school_name: schoolName, teacher_name: name },
      },
    })
    inviteLink = linkData?.properties.action_link ?? null
  }

  if (inviteLink) {
    await sendEmail({
      to: { email, name },
      subject: `You've been invited to teach at ${schoolName} — No Under 40`,
      htmlBody: teacherInviteEmailHtml(name, schoolName, inviteLink),
    }).catch(() => {})
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, school_id').eq('id', user.id).single()
  if (profile?.role !== 'school' || !profile.school_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const db = admin()
  await db.from('pending_invitations').delete().eq('id', id).eq('school_id', profile.school_id)

  return NextResponse.json({ success: true })
}
