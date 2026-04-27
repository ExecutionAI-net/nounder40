import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/zepto'
import { teacherInviteEmailHtml } from '@/lib/email-templates'

export const dynamic = 'force-dynamic'

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

  const { data: profile } = await supabase.from('profiles').select('role, roles, school_id').eq('id', user.id).single()
  const isSchool = profile?.role === 'school' || profile?.roles?.includes('school')
  if (!isSchool || !profile?.school_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = admin()

  const [{ data: teachers, error }, { data: pending }] = await Promise.all([
    db.from('teacher_schools')
      .select('teacher_id, active, compensation_plan_id, teachers(id, name, email, phone, active, created_at)')
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
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const user = session.user
    const db = admin()

    const [{ data: profile }, body] = await Promise.all([
      db.from('profiles').select('role, roles, school_id').eq('id', user.id).single(),
      request.json() as Promise<{ name: string; email: string; phone?: string }>,
    ])

    const isSchool = profile?.role === 'school' || profile?.roles?.includes('school')
    if (!isSchool || !profile?.school_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { name, email, phone } = body
    if (!name || !email) return NextResponse.json({ error: 'name and email are required' }, { status: 400 })

    const schoolId = profile.school_id
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://nounder40-n48u-five.vercel.app'

    // Check if auth user already exists (via profiles table)
    const { data: existingProfile } = await db
      .from('profiles')
      .select('id, role, roles')
      .eq('email', email)
      .maybeSingle()

    let teacherUserId: string
    let isNewAuthUser: boolean

    if (existingProfile) {
      // User already has an auth account — link them as teacher
      teacherUserId = existingProfile.id
      isNewAuthUser = false
    } else {
      // Create new auth user with a random password they'll reset via invite link
      const { data: userData, error: createError } = await db.auth.admin.createUser({
        email,
        password: randomUUID(),
        email_confirm: true,
        user_metadata: {
          full_name: name,
          teacher_invite: true,
          school_id: schoolId,
          teacher_name: name,
        },
      })
      if (createError) return NextResponse.json({ error: createError.message }, { status: 500 })
      teacherUserId = userData.user.id
      isNewAuthUser = true
    }

    // Check if teacher record already exists (by email)
    const { data: existingTeacher } = await db
      .from('teachers')
      .select('id')
      .eq('email', email)
      .maybeSingle()

    let teacherId: string

    if (existingTeacher) {
      teacherId = existingTeacher.id
      await db.from('teachers').update({ user_id: teacherUserId, active: true }).eq('id', teacherId)
    } else {
      const { data: teacher, error: teacherError } = await db.from('teachers').insert({
        user_id: teacherUserId,
        name,
        email,
        phone: phone || null,
        active: true,
      }).select('id').single()

      if (teacherError) {
        if (isNewAuthUser) await db.auth.admin.deleteUser(teacherUserId)
        return NextResponse.json({ error: teacherError.message }, { status: 500 })
      }
      teacherId = teacher.id
    }

    // Check if teacher is already linked to this school
    const { data: existingLink } = await db
      .from('teacher_schools')
      .select('teacher_id')
      .eq('teacher_id', teacherId)
      .eq('school_id', schoolId)
      .maybeSingle()

    if (existingLink) {
      return NextResponse.json({ error: 'This teacher is already linked to your school' }, { status: 400 })
    }

    // Link teacher to school
    await db.from('teacher_schools').insert({ teacher_id: teacherId, school_id: schoolId, active: true })

    // Create/update profile with teacher role
    const currentRoles: string[] = existingProfile?.roles?.length
      ? existingProfile.roles
      : existingProfile?.role ? [existingProfile.role] : []

    await db.from('profiles').upsert({
      id: teacherUserId,
      email,
      name,
      role: 'teacher',
      roles: Array.from(new Set([...currentRoles, 'teacher'])),
      school_id: schoolId,
    })

    // Generate invite/magic link and send email
    const { data: school } = await db.from('schools').select('name').eq('id', schoolId).single()
    const schoolName = school?.name ?? 'the school'

    let inviteLink: string | null = null

    if (isNewAuthUser) {
      // New user — use Supabase invite link (redirects to /auth/callback → /setup-account)
      const { data: linkData } = await db.auth.admin.generateLink({
        type: 'invite',
        email,
        options: {
          redirectTo: `${appUrl}/auth/callback`,
          data: { teacher_invite: true, school_id: schoolId, teacher_name: name },
        },
      })
      inviteLink = linkData?.properties?.action_link ?? null
    }

    if (!inviteLink) {
      // Existing user — send magic link directly to setup-account
      const { data: magicData } = await db.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: { redirectTo: `${appUrl}/setup-account` },
      })
      inviteLink = magicData?.properties?.action_link ?? null
    }

    if (inviteLink) {
      await sendEmail({
        to: { email, name },
        subject: `You've been invited to teach at ${schoolName} — No Under 40`,
        htmlBody: teacherInviteEmailHtml(name, schoolName, inviteLink),
      })
    }

    console.log(`[POST /api/school/teachers] teacher ${teacherId} added to school ${schoolId}, emailSent=${!!inviteLink}`)
    return NextResponse.json({ success: true, teacher_id: teacherId })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('POST /api/school/teachers error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, roles, school_id').eq('id', user.id).single()
  const isSchool = profile?.role === 'school' || profile?.roles?.includes('school')
  if (!isSchool || !profile?.school_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { teacher_id } = await request.json()
  if (!teacher_id) return NextResponse.json({ error: 'teacher_id is required' }, { status: 400 })

  const db = admin()
  // Unlink teacher from this school (does not delete the teacher record itself)
  await db.from('teacher_schools')
    .delete()
    .eq('teacher_id', teacher_id)
    .eq('school_id', profile.school_id)

  return NextResponse.json({ success: true })
}
