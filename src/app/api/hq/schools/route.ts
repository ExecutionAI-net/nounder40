import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/zepto'

function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'hq') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await supabase
    .from('schools')
    .select('id, name, city, active')
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'hq') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { name, email, city, country, platform_fee_percentage, free_trial_days } = body

  if (!name || !email || !city) {
    return NextResponse.json({ error: 'name, email and city are required' }, { status: 400 })
  }

  // Use regular supabase client (HQ RLS policy allows this)
  const slug = slugify(name)
  const freeTrialEndsAt = Number(free_trial_days) > 0
    ? new Date(Date.now() + Number(free_trial_days) * 86400000).toISOString()
    : null

  const { data: school, error: schoolError } = await supabase
    .from('schools')
    .insert({
      name,
      slug: `${slug}-${Date.now()}`,
      email,
      city,
      country: country ?? 'IT',
      platform_fee_percentage: Number(platform_fee_percentage) || 15,
      free_trial_ends_at: freeTrialEndsAt,
      active: false,
    })
    .select()
    .single()

  if (schoolError) {
    return NextResponse.json({ error: schoolError.message }, { status: 500 })
  }

  // Send invite in background (non-blocking) via admin client
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://nounder40-n48u-five.vercel.app'
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Fire-and-forget invite (don't await)
  admin.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo: `${appUrl}/auth/callback` },
  }).then(async ({ data: linkData, error: linkError }) => {
    if (linkError || !linkData) return
    const invitedUserId = linkData.user.id
    const inviteLink = linkData.properties.action_link

    await admin.from('profiles').upsert({
      id: invitedUserId,
      email,
      name: `${name} Admin`,
      role: 'school',
      school_id: school.id,
      school_sub_role: 'admin',
    })

    sendEmail({
      to: { email, name },
      subject: `You've been invited to No Under 40 — ${name}`,
      htmlBody: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:40px 20px">
          <h2 style="color:#6B1F3A">Welcome to No Under 40</h2>
          <p>Your school <strong>${name}</strong> has been registered on the No Under 40 platform.</p>
          <a href="${inviteLink}" style="display:inline-block;margin:20px 0;padding:12px 24px;background:#6B1F3A;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
            Set Password & Login
          </a>
        </div>
      `,
    }).catch(() => {})
  }).catch(() => {})

  return NextResponse.json({ id: school.id, name: school.name })
}
