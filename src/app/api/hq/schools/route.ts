import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, roles').eq('id', user.id).single()
  if (!(profile?.role === 'hq' || profile?.roles?.includes('hq'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: schools, error } = await supabase
    .from('schools')
    .select('id, name, city, country, email, phone, address, address_line2, province, vat_number, active, platform_fee_percentage, created_at')
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
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const db = admin()

    const [{ data: profile }, body] = await Promise.all([
      db.from('profiles').select('role, roles').eq('id', session.user.id).single(),
      request.json() as Promise<{ name: string; email: string; city: string; country?: string; address?: string; address_line2?: string; province?: string; vat_number?: string; platform_fee_percentage?: string; free_trial_days?: string }>,
    ])

    if (!(profile?.role === 'hq' || profile?.roles?.includes('hq'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { name, email, city, country, address, address_line2, province, vat_number, platform_fee_percentage, free_trial_days } = body
    if (!name || !email || !city) {
      return NextResponse.json({ error: 'name, email and city are required' }, { status: 400 })
    }

    const schoolId = randomUUID()
    const slug = `${slugify(name)}-${Date.now()}`
    const freeTrialEndsAt = Number(free_trial_days) > 0
      ? new Date(Date.now() + Number(free_trial_days) * 86400000).toISOString()
      : null

    // Insert school (no .select() needed — we already have the ID)
    const { error: schoolError } = await db.from('schools').insert({
      id: schoolId,
      name,
      slug,
      email,
      city,
      country: country ?? 'IT',
      address: address || null,
      address_line2: address_line2 || null,
      province: province || null,
      vat_number: vat_number || null,
      platform_fee_percentage: Number(platform_fee_percentage) || 15,
      free_trial_ends_at: freeTrialEndsAt,
      active: true,
    })

    if (schoolError) return NextResponse.json({ error: schoolError.message }, { status: 500 })

    // Set up profile for existing users (profiles table lookup by email — fast)
    const { data: existingProfile } = await db
      .from('profiles')
      .select('id, roles, role')
      .eq('email', email)
      .maybeSingle()

    if (existingProfile) {
      const currentRoles: string[] = existingProfile.roles?.length
        ? existingProfile.roles
        : existingProfile.role ? [existingProfile.role] : []
      await db.from('profiles').update({
        roles: Array.from(new Set([...currentRoles, 'school'])),
        school_id: schoolId,
        school_sub_role: 'owner',
      }).eq('id', existingProfile.id)
      await db.from('schools').update({ user_id: existingProfile.id }).eq('id', schoolId)
    } else {
      // No profile found by email — try auth.users as fallback (handles email case mismatch or missing profile)
      const { data: { users } } = await db.auth.admin.listUsers()
      const authUser = users.find(u => u.email?.toLowerCase() === email.toLowerCase())
      if (authUser) {
        const { data: authProfile } = await db.from('profiles').select('id, roles, role, name').eq('id', authUser.id).maybeSingle()
        const currentRoles: string[] = authProfile?.roles?.length
          ? authProfile.roles
          : authProfile?.role ? [authProfile.role] : []
        await db.from('profiles').upsert({
          id: authUser.id,
          email,
          name: authProfile?.name ?? `${name} Admin`,
          role: authProfile?.role ?? 'school',
          roles: Array.from(new Set([...currentRoles, 'school'])),
          school_id: schoolId,
          school_sub_role: 'owner',
        }, { onConflict: 'id' })
        await db.from('schools').update({ user_id: authUser.id }).eq('id', schoolId)
      }
      // Truly new user: profile will be created in resend-invite when generateLink succeeds
    }

    return NextResponse.json({ id: schoolId, name, email })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('POST /api/hq/schools error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
