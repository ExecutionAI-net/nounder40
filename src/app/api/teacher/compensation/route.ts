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

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: teacher } = await supabase
    .from('teachers')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!teacher) return NextResponse.json({ error: 'Teacher not found' }, { status: 404 })

  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month') // format: '2026-04'

  // Default to current month
  const now = new Date()
  const targetMonth = month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [year, mon] = targetMonth.split('-').map(Number)
  const monthStart = `${targetMonth}-01`
  const monthEnd = new Date(year, mon, 0).toISOString().split('T')[0] // last day

  // Get teacher-school assignments
  const { data: assignments } = await supabase
    .from('teacher_schools')
    .select('school_id, compensation_plan_id, schools(name, city)')
    .eq('teacher_id', teacher.id)

  // Fetch compensation plans separately (no FK relationship)
  const planIds = (assignments ?? []).map(a => a.compensation_plan_id).filter(Boolean)
  const { data: plans } = planIds.length > 0
    ? await supabase.from('compensation_plans').select('id, name, base_fee, bonus_threshold, bonus_per_student').in('id', planIds)
    : { data: [] }

  const planMap: Record<string, { id: string; name: string; base_fee: number; bonus_threshold: number; bonus_per_student: number }> = {}
  for (const p of plans ?? []) planMap[p.id] = p

  // Fetch payment statuses for this month
  const schoolIds = (assignments ?? []).map(a => a.school_id)
  const { data: payments } = schoolIds.length > 0
    ? await admin()
        .from('teacher_compensation_payments')
        .select('school_id, amount, status, paid_at, note')
        .eq('teacher_id', teacher.id)
        .eq('month', targetMonth)
        .in('school_id', schoolIds)
    : { data: [] }

  const paymentMap: Record<string, { amount: number; status: string; paid_at: string | null; note: string | null }> = {}
  for (const p of payments ?? []) paymentMap[p.school_id] = p

  // Build a map: school_id -> plan for trend calculation
  const schoolPlanMap: Record<string, typeof planMap[string] | null> = {}
  for (const a of assignments ?? []) {
    schoolPlanMap[a.school_id] = a.compensation_plan_id ? (planMap[a.compensation_plan_id] ?? null) : null
  }

  // Fetch last 6 months totals for trend (all schools combined)
  const trendMonths: { month: string; total: number }[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(year, mon - 1 - i, 1)
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const mStart = `${m}-01`
    const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0]

    const { data: mLessons } = await supabase
      .from('lessons')
      .select('school_id, current_bookings')
      .eq('teacher_id', teacher.id)
      .eq('status', 'completed')
      .gte('date', mStart)
      .lte('date', mEnd)

    let mTotal = 0
    for (const l of mLessons ?? []) {
      const p = schoolPlanMap[l.school_id] ?? null
      if (p) {
        const students = l.current_bookings ?? 0
        let fee = p.base_fee
        if (students > p.bonus_threshold) fee += (students - p.bonus_threshold) * p.bonus_per_student
        mTotal += fee
      }
    }
    trendMonths.push({ month: m, total: mTotal })
  }

  // For each school, calculate compensation for selected month
  const result = []
  for (const a of assignments ?? []) {
    const plan = a.compensation_plan_id ? (planMap[a.compensation_plan_id] ?? null) : null
    const school = a.schools as unknown as { name: string; city: string } | null
    const payment = paymentMap[a.school_id] ?? null

    if (!plan) {
      result.push({ school, plan: null, lessons: [], total: 0, payment })
      continue
    }

    const { data: lessons } = await supabase
      .from('lessons')
      .select('id, date, start_time, current_bookings, courses(name)')
      .eq('teacher_id', teacher.id)
      .eq('school_id', a.school_id)
      .eq('status', 'completed')
      .gte('date', monthStart)
      .lte('date', monthEnd)
      .order('date')

    let total = 0
    let bonusLessons = 0
    const lessonDetails = (lessons ?? []).map(l => {
      const students = l.current_bookings ?? 0
      let fee = plan.base_fee
      let hasBonus = false
      if (students > plan.bonus_threshold) {
        fee += (students - plan.bonus_threshold) * plan.bonus_per_student
        hasBonus = true
        bonusLessons++
      }
      total += fee
      return {
        id: l.id,
        date: l.date,
        start_time: l.start_time,
        course: (l.courses as unknown as { name: string } | null)?.name,
        students,
        fee,
        has_bonus: hasBonus,
        threshold_gap: students < plan.bonus_threshold ? plan.bonus_threshold - students : 0,
      }
    })

    result.push({
      school,
      plan,
      lessons: lessonDetails,
      total,
      bonus_lessons: bonusLessons,
      payment,
    })
  }

  return NextResponse.json({ month: targetMonth, entries: result, trend: trendMonths })
}
