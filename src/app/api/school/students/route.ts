import { NextResponse } from 'next/server'
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

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('school_id')
    .eq('id', user.id)
    .single()

  if (!profile?.school_id) return NextResponse.json({ error: 'School not found' }, { status: 404 })

  const db = admin()

  const { data: schoolStudents, error: ssError } = await db
    .from('school_students')
    .select('id, enrolled_at, free_lesson_used, student_id')
    .eq('school_id', profile.school_id)
    .order('enrolled_at', { ascending: false })

  if (ssError) {
    console.error('[school/students] school_students error:', ssError.message)
    return NextResponse.json({ error: ssError.message }, { status: 500 })
  }

  if (!schoolStudents || schoolStudents.length === 0) return NextResponse.json([])

  const studentIds = schoolStudents.map(r => r.student_id)

  // school_students.student_id referenzia students.id (non user_id)
  const { data: students, error: stError } = await db
    .from('students')
    .select('id, user_id, name, email, phone, city, created_at')
    .in('id', studentIds)

  if (stError) {
    console.error('[school/students] students error:', stError.message)
    return NextResponse.json({ error: stError.message }, { status: 500 })
  }

  const studentMap: Record<string, { id: string; user_id: string; name: string; email: string; phone: string | null; city: string | null; created_at: string }> = {}
  for (const s of students ?? []) studentMap[s.id] = s

  // Fetch active packages and subscriptions for these students
  const { data: packages } = await db
    .from('student_packages')
    .select('student_id, credits_remaining, expires_at, packages(name_en)')
    .eq('school_id', profile.school_id)
    .eq('status', 'active')
    .gt('credits_remaining', 0)
    .gte('expires_at', new Date().toISOString())

  const { data: subscriptions } = await db
    .from('student_subscriptions')
    .select('student_id, subscriptions_catalog(name_en)')
    .eq('school_id', profile.school_id)
    .eq('status', 'active')

  const pkgMap: Record<string, { name: string; credits: number; expires_at: string }[]> = {}
  for (const p of packages ?? []) {
    const pkg = p.packages as unknown as { name_en: string } | null
    if (!pkgMap[p.student_id]) pkgMap[p.student_id] = []
    pkgMap[p.student_id].push({ name: pkg?.name_en ?? 'Package', credits: p.credits_remaining, expires_at: p.expires_at })
  }

  const subMap: Record<string, { name: string }[]> = {}
  for (const s of subscriptions ?? []) {
    const sub = s.subscriptions_catalog as unknown as { name_en: string } | null
    if (!subMap[s.student_id]) subMap[s.student_id] = []
    subMap[s.student_id].push({ name: sub?.name_en ?? 'Subscription' })
  }

  const result = schoolStudents.map(r => ({
    id: r.id,
    enrolled_at: r.enrolled_at,
    free_lesson_used: r.free_lesson_used,
    students: studentMap[r.student_id] ?? null,
    packages: pkgMap[r.student_id] ?? [],
    subscriptions: subMap[r.student_id] ?? [],
  }))

  return NextResponse.json(result)
}

// PATCH /api/school/students
// Body: { school_student_id, free_lesson_used }
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('school_id')
    .eq('id', user.id)
    .single()

  if (!profile?.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { school_student_id, free_lesson_used, student_user_id, name, phone } = body

  // Edit student profile (name + phone)
  if (student_user_id && (name !== undefined || phone !== undefined)) {
    const updateFields: Record<string, string> = {}
    if (name !== undefined) updateFields.name = name
    if (phone !== undefined) updateFields.phone = phone

    const { error } = await admin()
      .from('students')
      .update(updateFields)
      .eq('user_id', student_user_id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ updated: true })
  }

  // Toggle free lesson
  if (!school_student_id || typeof free_lesson_used !== 'boolean') {
    return NextResponse.json({ error: 'school_student_id and free_lesson_used required' }, { status: 400 })
  }

  const { error } = await admin()
    .from('school_students')
    .update({ free_lesson_used })
    .eq('id', school_student_id)
    .eq('school_id', profile.school_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ updated: true })
}
