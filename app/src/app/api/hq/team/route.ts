import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/zepto'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'hq') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: members } = await supabase
    .from('profiles')
    .select('id, name, email, hq_sub_role, created_at')
    .eq('role', 'hq')
    .order('created_at', { ascending: false })

  return NextResponse.json(members ?? [])
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, hq_sub_role').eq('id', user.id).single()
  if (profile?.role !== 'hq' || profile.hq_sub_role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden: Super Admin only' }, { status: 403 })
  }

  const { name, email, hq_sub_role } = await request.json()
  if (!name || !email || !hq_sub_role) {
    return NextResponse.json({ error: 'name, email and hq_sub_role are required' }, { status: 400 })
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://nounder40-n48u-five.vercel.app'
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo: `${appUrl}/auth/callback` },
  })

  if (linkError) return NextResponse.json({ error: linkError.message }, { status: 500 })

  const userId = linkData.user.id
  const inviteLink = linkData.properties.action_link

  await admin.from('profiles').upsert({
    id: userId,
    name,
    role: 'hq',
    hq_sub_role,
  })

  try {
    await sendEmail({
      to: { email, name },
      subject: "You've been invited to No Under 40 HQ",
      htmlBody: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:40px 20px">
          <h2 style="color:#6B1F3A">Welcome to No Under 40 HQ</h2>
          <p>You have been added to the HQ team as <strong>${hq_sub_role.replace('_', ' ')}</strong>.</p>
          <p>Click the button below to set your password and access the HQ dashboard:</p>
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

  return NextResponse.json({ id: userId })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, hq_sub_role').eq('id', user.id).single()
  if (profile?.role !== 'hq' || profile.hq_sub_role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  if (id === user.id) return NextResponse.json({ error: 'Cannot remove yourself' }, { status: 400 })

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  await admin.auth.admin.deleteUser(id)
  await admin.from('profiles').delete().eq('id', id)

  return NextResponse.json({ success: true })
}
