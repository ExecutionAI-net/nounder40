import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function getSchoolId(supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
  return data?.school_id ?? null
}

// GET /api/school/compensation-payments?month=2026-04
// Returns per-teacher summary for the month
export async function GET(request: Request) {
  const supabase = await createClient()
  const schoolId = await getSchoolId(supabase)
  if (!schoolId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const now = new Date()
  const month = searchParams.get('month') ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [year, mon] = month.split('-').map(Number)
  const monthStart = `${month}-01`
  const monthEnd = new Date(year, mon, 0).toISOString().split('T')[0]

  // Get all teacher-school assignments for this school
  const { data: assignments } = await supabase
    .from('teacher_schools')
    .select('teacher_id')
    .eq('school_id', schoolId)

  if (!assignments || assignments.length === 0) return NextResponse.json([])

  const teacherIds = assignments.map(a => a.teacher_id)

  // Fetch teachers info
  const { data: teachers } = await supabase
    .from('teachers')
    .select('id, name, email')
    .in('id', teacherIds)

  const teacherMap: Record<string, { id: string; name: string; email: string }> = {}
  for (const t of teachers ?? []) teacherMap[t.id] = t

  // Fetch completed lessons for this school this month (with course_id)
  const { data: lessons } = await supabase
    .from('lessons')
    .select('id, teacher_id, course_id, current_bookings')
    .eq('school_id', schoolId)
    .eq('status', 'completed')
    .gte('date', monthStart)
    .lte('date', monthEnd)
    .in('teacher_id', teacherIds)

  // Get course plans: course_id → compensation_plan_id
  const courseIds = [...new Set((lessons ?? []).map(l => l.course_id).filter(Boolean) as string[])]
  const { data: coursesData } = courseIds.length > 0
    ? await supabase.from('courses').select('id, compensation_plan_id').in('id', courseIds)
    : { data: [] }

  const coursePlanIdMap: Record<string, string | null> = {}
  for (const c of coursesData ?? []) coursePlanIdMap[c.id] = c.compensation_plan_id

  // Fetch all referenced compensation plans
  const planIds = [...new Set(Object.values(coursePlanIdMap).filter(Boolean) as string[])]
  const { data: plans } = planIds.length > 0
    ? await supabase.from('compensation_plans').select('id, name, base_fee, bonus_threshold, bonus_max_threshold, bonus_per_student').in('id', planIds)
    : { data: [] }

  const planMap: Record<string, { id: string; name: string; base_fee: number; bonus_threshold: number; bonus_max_threshold: number | null; bonus_per_student: number }> = {}
  for (const p of plans ?? []) planMap[p.id] = p

  // Fetch existing payment records (use admin client to bypass RLS)
  const { data: payments } = await admin()
    .from('teacher_compensation_payments')
    .select('teacher_id, amount, status, paid_at, note')
    .eq('school_id', schoolId)
    .eq('month', month)
    .in('teacher_id', teacherIds)

  const paymentMap: Record<string, { amount: number; status: string; paid_at: string | null; note: string | null }> = {}
  for (const p of payments ?? []) paymentMap[p.teacher_id] = p

  // Calculate per-teacher summary
  const result = assignments.map(a => {
    const teacher = teacherMap[a.teacher_id]
    const teacherLessons = (lessons ?? []).filter(l => l.teacher_id === a.teacher_id)
    const payment = paymentMap[a.teacher_id] ?? null

    let total = 0
    let lessonCount = 0
    let bonusLessons = 0

    for (const l of teacherLessons) {
      lessonCount++
      const planId = l.course_id ? (coursePlanIdMap[l.course_id] ?? null) : null
      const plan = planId ? (planMap[planId] ?? null) : null
      if (!plan) continue

      const students = l.current_bookings ?? 0
      let fee = plan.base_fee
      if (plan.bonus_threshold > 0 && students > plan.bonus_threshold) {
        const cappedStudents = plan.bonus_max_threshold
          ? Math.min(students, plan.bonus_max_threshold)
          : students
        const bonusStudents = cappedStudents - plan.bonus_threshold
        if (bonusStudents > 0) {
          fee += bonusStudents * plan.bonus_per_student
          bonusLessons++
        }
      }
      total += fee
    }

    return {
      teacher_id: a.teacher_id,
      teacher,
      lesson_count: lessonCount,
      bonus_lessons: bonusLessons,
      total,
      payment,
    }
  })

  return NextResponse.json(result)
}

// POST /api/school/compensation-payments
// Body: { teacher_id, month, status, note? }
// Upserts payment record
export async function POST(request: Request) {
  const supabase = await createClient()
  const schoolId = await getSchoolId(supabase)
  if (!schoolId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { teacher_id, month, status, note, amount } = await request.json()

  if (!teacher_id || !month || !status) {
    return NextResponse.json({ error: 'teacher_id, month and status required' }, { status: 400 })
  }

  const db = admin()

  // Check if record exists first
  const { data: existing } = await db
    .from('teacher_compensation_payments')
    .select('id')
    .eq('teacher_id', teacher_id)
    .eq('school_id', schoolId)
    .eq('month', month)
    .maybeSingle()

  console.log('[compensation-payments] existing:', existing, 'teacher_id:', teacher_id, 'school_id:', schoolId, 'month:', month, 'status:', status)

  let error
  if (existing) {
    const updatePayload = {
      amount: amount ?? 0,
      status,
      paid_at: status === 'paid' ? new Date().toISOString() : null,
      note: note ?? null,
    }
    console.log('[compensation-payments] updating id:', existing.id, 'payload:', updatePayload)
    const { data: updateData, error: updateErr } = await db
      .from('teacher_compensation_payments')
      .update(updatePayload)
      .eq('id', existing.id)
      .select()
    console.log('[compensation-payments] update result — error:', updateErr, 'data:', updateData)
    error = updateErr
  } else {
    const { error: insertErr } = await db
      .from('teacher_compensation_payments')
      .insert({
        teacher_id,
        school_id: schoolId,
        month,
        amount: amount ?? 0,
        status,
        paid_at: status === 'paid' ? new Date().toISOString() : null,
        note: note ?? null,
      })
    error = insertErr
  }

  if (error) {
    console.error('[compensation-payments] write error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ updated: true })
}
