import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/zepto'
import { welcomeEmailHtml } from '@/lib/email-templates'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const next = searchParams.get('next')

  const supabase = await createClient()

  // Handle both PKCE (code) and email confirmation (token_hash) flows
  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type: type as 'signup' | 'email' | 'recovery' | 'invite',
    })
    if (error) return NextResponse.redirect(`${origin}/login?error=auth`)
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) return NextResponse.redirect(`${origin}/login?error=auth`)
  } else {
    return NextResponse.redirect(`${origin}/login?error=auth`)
  }

  // Auth succeeded — get user and redirect appropriately
  if (next === '/reset-password') {
    return NextResponse.redirect(`${origin}/reset-password`)
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${origin}/login?error=auth`)

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const meta = user.user_metadata ?? {}
  const isHQInvite = !!meta.hq_sub_role
  const isTeacherInvite = !!meta.teacher_invite
  const isSchoolInvite = !!meta.school_invite

  if (isTeacherInvite) {
    return NextResponse.redirect(`${origin}/setup-account`)
  }

  if (isSchoolInvite) {
    return NextResponse.redirect(`${origin}/setup-account`)
  }

  if (isHQInvite) {
    const { data: existingProfile } = await admin
      .from('profiles')
      .select('id, roles, role')
      .eq('id', user.id)
      .single()

    const currentRoles: string[] = existingProfile?.roles?.length
      ? existingProfile.roles
      : existingProfile?.role ? [existingProfile.role] : []

    await admin.from('profiles').upsert({
      id: user.id,
      email: user.email!,
      name: meta.name ?? meta.full_name ?? user.email!.split('@')[0],
      role: 'hq',
      roles: Array.from(new Set([...currentRoles, 'hq'])),
      hq_sub_role: meta.hq_sub_role,
    })

    await admin.from('pending_invitations').delete().eq('email', user.email!)
    return NextResponse.redirect(`${origin}/setup-account`)
  }

  // Regular student/school login or email confirmation
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, roles, name')
    .eq('id', user.id)
    .single()

  // Send welcome email if email was just confirmed (within last 2 minutes)
  const confirmedAt = user.email_confirmed_at ? new Date(user.email_confirmed_at) : null
  const justVerified = confirmedAt && (Date.now() - confirmedAt.getTime()) < 120_000

  if (justVerified && user.email) {
    const name = profile?.name ?? user.email.split('@')[0]
    sendEmail({
      to: { email: user.email, name },
      subject: 'Welcome to No Under 40!',
      htmlBody: welcomeEmailHtml(name),
    }).catch(() => {})
  }

  // For newly confirmed students: create student record + school link from metadata
  if (justVerified && profile?.role === 'student' && meta.school_id) {
    const schoolId = meta.school_id as string
    const { data: existingStudent } = await supabase
      .from('students').select('id').eq('user_id', user.id).maybeSingle()
    let studentId = existingStudent?.id
    if (!studentId) {
      const { data: newStudent } = await supabase.from('students').insert({
        user_id: user.id,
        name: profile.name ?? meta.name ?? user.email!.split('@')[0],
        email: user.email!,
        phone: meta.phone ?? null,
        date_of_birth: meta.date_of_birth ?? null,
        city: meta.city ?? null,
        country: meta.country ?? null,
      }).select('id').single()
      studentId = newStudent?.id
    }
    if (studentId) {
      await supabase.from('school_students').upsert(
        { school_id: schoolId, student_id: studentId, free_lesson_used: false },
        { onConflict: 'school_id,student_id', ignoreDuplicates: true }
      )
    }
  }

  const roles: string[] = profile?.roles?.length ? profile.roles : [profile?.role ?? 'student']
  if (roles.length > 1) {
    return NextResponse.redirect(`${origin}/select-role`)
  }

  const role = profile?.role ?? 'student'
  return NextResponse.redirect(`${origin}/${role}/dashboard`)
}
