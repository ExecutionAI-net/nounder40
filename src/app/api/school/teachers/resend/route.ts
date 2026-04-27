import { NextResponse } from 'next/server'
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

export async function POST(request: Request) {
  try {
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

  // Verify teacher is linked to this school and fetch their info
  const { data: teacherSchool } = await db
    .from('teacher_schools')
    .select('teachers(name, email)')
    .eq('teacher_id', teacher_id)
    .eq('school_id', profile.school_id)
    .single()

  if (!teacherSchool) return NextResponse.json({ error: 'Teacher not found' }, { status: 404 })

  const invitation = teacherSchool.teachers as unknown as { name: string; email: string } | null
  if (!invitation) return NextResponse.json({ error: 'Teacher not found' }, { status: 404 })

  const { data: school } = await db.from('schools').select('name').eq('id', profile.school_id).single()
  const schoolName = school?.name ?? 'the school'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://nounder40-n48u-five.vercel.app'

  let inviteLink: string | null = null

  // Try invite link first (works for truly new users)
  const { data: linkData } = await db.auth.admin.generateLink({
    type: 'invite',
    email: invitation.email,
    options: {
      redirectTo: `${appUrl}/auth/callback`,
      data: {
        teacher_invite: true,
        school_id: profile.school_id,
        school_name: schoolName,
        teacher_name: invitation.name,
      },
    },
  })

  if (linkData && linkData.user) {
    inviteLink = linkData.properties.action_link ?? null
  } else {
    // Existing auth user (e.g. Google OAuth) — send magic link instead
    const { data: magicData } = await db.auth.admin.generateLink({
      type: 'magiclink',
      email: invitation.email,
      options: { redirectTo: `${appUrl}/setup-account` },
    })
    inviteLink = magicData?.properties?.action_link ?? null
  }

  if (!inviteLink) {
    return NextResponse.json({ error: 'Failed to generate invite link' }, { status: 500 })
  }

  await sendEmail({
    to: { email: invitation.email, name: invitation.name },
    subject: `You've been invited to teach at ${schoolName} — No Under 40`,
    htmlBody: teacherInviteEmailHtml(invitation.name, schoolName, inviteLink),
  })

  return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('POST /api/school/teachers/resend error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
