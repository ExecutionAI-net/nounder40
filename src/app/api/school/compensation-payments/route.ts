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
    .select('teacher_id, compensation_plan_id')
    .eq('school_id', schoolId)

  if (!assignments || assignments.length === 0) return NextResponse.json([])

  const teacherIds = assignments.map(a => a.teacher_id)
  const planIds = assignments.map(a => a.compensation_plan_id).filter(Boolean)

  // Fetch teachers info
  const { data: teachers } = await supabase
    .from('teachers')
    .select('id, name, email')
    .in('id', teacherIds)

  // Fetch compensation plans
  const { data: plans } = planIds.length > 0
    ? await supabase.from('compensation_plans').select('id, name, base_fee, bonus_threshold, bonus_per_student').in('id', planIds)
    : { data: [] }

  const planMap: Record<string, { id: string; name: string; base_fee: number; bonus_threshold: number; bonus_per_student: number }> = {}
  for (const p of plans ?? []) planMap[p.id] = p

  const teacherMap: Record<string, { id: string; name: string; email: string }> = {}
  for (const t of teachers ?? []) teacherMap[t.id] = t

  // Fetch completed lessons for this school this month
  const { data: lessons } = await supabase
    .from('lessons')
    .select('id, teacher_id, current_bookings')
    .eq('school_id', schoolId)
    .eq('status', 'completed')
    .gte('date', monthStart)
    .lte('date', monthEnd)
    .in('teacher_id', teacherIds)

  // Fetch existing payment records
  const { data: payments } = await supabase
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
    const plan = a.compensation_plan_id ? (planMap[a.compensation_plan_id] ?? null) : null
    const teacherLessons = (lessons ?? []).filter(l => l.teacher_id === a.teacher_id)
    const payment = paymentMap[a.teacher_id] ?? null

    let total = 0
    let lessonCount = 0
    let bonusLessons = 0

    if (plan) {
      for (const l of teacherLessons) {
        const students = l.current_bookings ?? 0
        let fee = plan.base_fee
        if (students > plan.bonus_threshold) {
          fee += (students - plan.bonus_threshold) * plan.bonus_per_student
          bonusLessons++
        }
        total += fee
        lessonCount++
      }
    }

    return {
      teacher_id: a.teacher_id,
      teacher,
      plan,
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
  const { error } = await db
    .from('teacher_compensation_payments')
    .upsert({
      teacher_id,
      school_id: schoolId,
      month,
      amount: amount ?? 0,
      status,
      paid_at: status === 'paid' ? new Date().toISOString() : null,
      note: note ?? null,
    }, { onConflict: 'teacher_id,school_id,month' })

  if (error) {
    console.error('[compensation-payments] upsert error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ updated: true })
}
