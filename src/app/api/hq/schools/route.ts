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

  const { data: schools, error } = await supabase
    .from('schools')
    .select('id, name, city, country, email, phone, address, active, platform_fee_percentage, created_at')
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!schools?.length) return NextResponse.json([])

  const today = new Date().toISOString().split('T')[0]
  const [{ data: teachers }, { data: students }, { data: lessons }] = await Promise.all([
    supabase.from('teacher_schools').select('school_id').eq('active', true),
    supabase.from('school_students').select('school_id'),
    supabase.from('lessons').select('school_id').eq('status', 'scheduled').gte('date', today),
  ])

  const tMap: Record<string, number> = {}
  const sMap: Record<string, number> = {}
  const lMap: Record<string, number> = {}
  teachers?.forEach(r => { tMap[r.school_id] = (tMap[r.school_id] || 0) + 1 })
  students?.forEach(r => { sMap[r.school_id] = (sMap[r.school_id] || 0) + 1 })
  lessons?.forEach(r => { lMap[r.school_id] = (lMap[r.school_id] || 0) + 1 })

  return NextResponse.json(schools.map(s => ({
    ...s,
    teacherCount: tMap[s.id] || 0,
    studentCount: sMap[s.id] || 0,
    activeLessonCount: lMap[s.id] || 0,
  })))
}

export async function POST(request: Request) {
  try {
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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://nounder40-n48u-five.vercel.app'

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Missing Supabase env vars' }, { status: 500 })
  }

  const admin = createAdminClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Check if user already exists
  const { data: existingProfile, error: profileLookupError } = await admin.from('profiles').select('id, roles, role').eq('email', email).single()
  if (profileLookupError && profileLookupError.code !== 'PGRST116') {
    console.error('Profile lookup error:', profileLookupError)
  }

  let inviteLink: string | null = null

  if (existingProfile) {
    // Existing user: update roles + school, send magic link
    const currentRoles: string[] = existingProfile.roles?.length ? existingProfile.roles : (existingProfile.role ? [existingProfile.role] : [])
    await admin.from('profiles').update({
      roles: Array.from(new Set([...currentRoles, 'school'])),
      school_id: school.id,
      school_sub_role: 'admin',
    }).eq('id', existingProfile.id)
    await admin.from('schools').update({ user_id: existingProfile.id }).eq('id', school.id)

    const { data: magicData } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: `${appUrl}/auth/callback` },
    })
    inviteLink = magicData?.properties.action_link ?? null
  } else {
    // New user: generate invite link with metadata
    const { data: linkData } = await admin.auth.admin.generateLink({
      type: 'invite',
      email,
      options: {
        redirectTo: `${appUrl}/auth/callback`,
        data: { school_invite: true, school_id: school.id, school_name: name },
      },
    })
    if (linkData) {
      const userId = linkData.user.id
      inviteLink = linkData.properties.action_link
      await admin.from('profiles').upsert({
        id: userId,
        email,
        name: `${name} Admin`,
        role: 'school',
        roles: ['school'],
        school_id: school.id,
        school_sub_role: 'admin',
      })
      await admin.from('schools').update({ user_id: userId }).eq('id', school.id)
    }
  }

  if (inviteLink) {
    try {
      await sendEmail({
        to: { email, name },
        subject: `You've been invited to No Under 40 — ${name}`,
        htmlBody: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden">
        <tr>
          <td style="background:#6B1F3A;padding:32px;text-align:center">
            <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px">No Under 40</h1>
            <p style="margin:8px 0 0;color:#f3d4de;font-size:13px">Classical Dance Network</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 40px 32px">
            <h2 style="margin:0 0 12px;color:#111827;font-size:20px;font-weight:600">Welcome to No Under 40!</h2>
            <p style="margin:0 0 20px;color:#6b7280;font-size:15px;line-height:1.6">
              Your school <strong style="color:#6B1F3A">${name}</strong> has been registered on the platform.
            </p>
            <p style="margin:0 0 28px;color:#6b7280;font-size:15px;line-height:1.6">
              Click the button below to set up your password and access your school dashboard.
            </p>
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#6B1F3A;border-radius:10px">
                  <a href="${inviteLink}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none">
                    Set Password &amp; Login →
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:24px 0 0;color:#9ca3af;font-size:13px;line-height:1.6">
              This link expires in 24 hours. If you did not expect this invitation, you can safely ignore this email.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #f3f4f6;text-align:center">
            <p style="margin:0;color:#9ca3af;font-size:12px">No Under 40 · Classical Dance Network</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
      })
    } catch (emailErr) {
      console.error('Failed to send invite email:', emailErr)
    }
  }

  return NextResponse.json({ id: school.id, name: school.name })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('POST /api/hq/schools error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
