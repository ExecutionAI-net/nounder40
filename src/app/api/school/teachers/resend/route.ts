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

export async function POST(request: Request) {
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

  const { data: invitation } = await db
    .from('pending_invitations')
    .select('name, email')
    .eq('id', id)
    .eq('school_id', profile.school_id)
    .single()

  if (!invitation) return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })

  const { data: school } = await db.from('schools').select('name').eq('id', profile.school_id).single()
  const schoolName = school?.name ?? 'the school'

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://nounder40-n48u-five.vercel.app'
  const { data: linkData, error: linkError } = await db.auth.admin.generateLink({
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

  if (linkError || !linkData) {
    return NextResponse.json({ error: linkError?.message ?? 'Failed to generate invite link' }, { status: 500 })
  }

  await sendEmail({
    to: { email: invitation.email, name: invitation.name },
    subject: `You've been invited to teach at ${schoolName} — No Under 40`,
    htmlBody: teacherInviteEmailHtml(invitation.name, schoolName, linkData.properties.action_link),
  })

  return NextResponse.json({ success: true })
}
