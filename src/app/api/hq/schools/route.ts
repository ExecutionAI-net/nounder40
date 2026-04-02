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

  // Fire-and-forget invite
  ;(async () => {
    // Check if user already exists in profiles
    const { data: existingProfile } = await admin.from('profiles').select('id, roles, role').eq('email', email).single()

    let inviteLink: string | null = null
    let userId: string | null = null

    if (existingProfile) {
      // Existing user: update roles + school immediately, send magic link
      userId = existingProfile.id
      const currentRoles: string[] = existingProfile.roles?.length ? existingProfile.roles : (existingProfile.role ? [existingProfile.role] : [])
      await admin.from('profiles').update({
        roles: Array.from(new Set([...currentRoles, 'school'])),
        school_id: school.id,
        school_sub_role: 'admin',
      }).eq('id', userId)
      await admin.from('schools').update({ user_id: userId }).eq('id', school.id)

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
        userId = linkData.user.id
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
      sendEmail({
        to: { email, name },
        subject: `You've been invited to No Under 40 — ${name}`,
        htmlBody: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:40px 20px;background:#f9fafb">
            <div style="background:#fff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden">
              <div style="background:#6B1F3A;padding:32px;text-align:center">
                <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700">No Under 40</h1>
              </div>
              <div style="padding:40px">
                <h2 style="margin:0 0 12px;color:#111827;font-size:20px">Welcome to No Under 40!</h2>
                <p style="margin:0 0 20px;color:#6b7280;font-size:15px;line-height:1.6">
                  Your school <strong style="color:#6B1F3A">${name}</strong> has been registered on the platform.
                </p>
                <p style="margin:0 0 28px;color:#6b7280;font-size:15px;line-height:1.6">
                  Click below to set up your password and access your school dashboard.
                </p>
                <a href="${inviteLink}" style="display:inline-block;padding:14px 28px;background:#6B1F3A;color:#fff;text-decoration:none;border-radius:10px;font-weight:600;font-size:15px">
                  Set Password & Login →
                </a>
                <p style="margin:24px 0 0;color:#9ca3af;font-size:13px">This link expires in 24 hours.</p>
              </div>
              <div style="padding:20px 40px;border-top:1px solid #f3f4f6;text-align:center">
                <p style="margin:0;color:#9ca3af;font-size:12px">No Under 40 · Classical Dance Network</p>
              </div>
            </div>
          </div>
        `,
      }).catch(() => {})
    }
  })().catch(() => {})

  return NextResponse.json({ id: school.id, name: school.name })
}
