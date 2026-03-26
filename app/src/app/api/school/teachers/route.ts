import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/zepto'

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

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: school } = await admin.from('schools').select('name').eq('id', profile.school_id).single()

  // Generate invite link
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://nounder40-n48u-five.vercel.app'
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo: `${appUrl}/auth/callback` },
  })

  if (linkError) return NextResponse.json({ error: linkError.message }, { status: 500 })

  const teacherUserId = linkData.user.id
  const inviteLink = linkData.properties.action_link

  // Create teacher record
  const { data: teacher, error: teacherError } = await admin.from('teachers').insert({
    user_id: teacherUserId,
    school_id: profile.school_id,
    name,
    email,
    phone: phone || null,
    active: true,
  }).select().single()

  if (teacherError) return NextResponse.json({ error: teacherError.message }, { status: 500 })

  // Create profile
  await admin.from('profiles').upsert({
    id: teacherUserId,
    name,
    role: 'teacher',
    school_id: profile.school_id,
  })

  // Send invitation email
  try {
    await sendEmail({
      to: { email, name },
      subject: `You've been invited as a teacher — ${school?.name ?? 'No Under 40'}`,
      htmlBody: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:40px 20px">
          <h2 style="color:#6B1F3A">Welcome to No Under 40</h2>
          <p>You've been invited to join <strong>${school?.name}</strong> as a teacher on the No Under 40 platform.</p>
          <p>Click the button below to set your password and access your teacher dashboard:</p>
          <a href="${inviteLink}" style="display:inline-block;margin:20px 0;padding:12px 24px;background:#6B1F3A;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
            Set Password & Login
          </a>
          <p style="color:#888;font-size:13px">This link expires in 24 hours.</p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
          <p style="color:#aaa;font-size:12px">No Under 40 Platform</p>
        </div>
      `,
    })
  } catch (e) {
    console.error('Email send error:', e)
  }

  return NextResponse.json({ id: teacher.id })
}
