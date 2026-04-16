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

type Plan = { id: string; name: string; base_fee: number; bonus_threshold: number; bonus_max_threshold: number | null; bonus_per_student: number }

function calcFee(plan: Plan, students: number): { fee: number; hasBonus: boolean } {
  let fee = plan.base_fee
  let hasBonus = false
  if (plan.bonus_threshold > 0 && students > plan.bonus_threshold) {
    const cappedStudents = plan.bonus_max_threshold
      ? Math.min(students, plan.bonus_max_threshold)
      : students
    const bonusStudents = cappedStudents - plan.bonus_threshold
    if (bonusStudents > 0) {
      fee += bonusStudents * plan.bonus_per_student
      hasBonus = true
    }
  }
  return { fee, hasBonus }
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
  const month = searchParams.get('month')

  // Default to current month
  const now = new Date()
  const targetMonth = month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [year, mon] = targetMonth.split('-').map(Number)
  const monthStart = `${targetMonth}-01`
  const monthEnd = new Date(year, mon, 0).toISOString().split('T')[0]

  // Get teacher-school assignments
  const { data: assignments } = await supabase
    .from('teacher_schools')
    .select('school_id, schools(name, city)')
    .eq('teacher_id', teacher.id)

  const schoolIds = (assignments ?? []).map(a => a.school_id)

  // Fetch payment statuses for this month
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

  // Pre-fetch all lessons for the 6-month trend period + current month in one query
  const trendStart = new Date(year, mon - 7, 1).toISOString().split('T')[0]

  const { data: allLessons } = await supabase
    .from('lessons')
    .select('id, date, school_id, compensation_plan_id, current_bookings')
    .eq('teacher_id', teacher.id)
    .eq('status', 'completed')
    .gte('date', trendStart)
    .lte('date', monthEnd)

  // Fetch all referenced plans
  const planIds = [...new Set((allLessons ?? []).map(l => l.compensation_plan_id).filter(Boolean) as string[])]
  const { data: plansData } = planIds.length > 0
    ? await supabase.from('compensation_plans').select('id, name, base_fee, bonus_threshold, bonus_max_threshold, bonus_per_student').in('id', planIds)
    : { data: [] }

  const planMap: Record<string, Plan> = {}
  for (const p of plansData ?? []) planMap[p.id] = p

  function getPlan(planId: string | null): Plan | null {
    if (!planId) return null
    return planMap[planId] ?? null
  }

  // Build 6-month trend
  const trendMonths: { month: string; total: number }[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(year, mon - 1 - i, 1)
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const mStart = `${m}-01`
    const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0]

    const mLessons = (allLessons ?? []).filter(l => l.date >= mStart && l.date <= mEnd)

    let mTotal = 0
    for (const l of mLessons) {
      const plan = getPlan(l.compensation_plan_id)
      if (!plan) continue
      const students = l.current_bookings ?? 0
      const { fee } = calcFee(plan, students)
      mTotal += fee
    }
    trendMonths.push({ month: m, total: mTotal })
  }

  // For each school, calculate compensation for selected month using detailed lesson data
  const result = []
  for (const a of assignments ?? []) {
    const school = a.schools as unknown as { name: string; city: string } | null
    const payment = paymentMap[a.school_id] ?? null

    const { data: lessons } = await supabase
      .from('lessons')
      .select('id, date, start_time, current_bookings, compensation_plan_id, courses(name)')
      .eq('teacher_id', teacher.id)
      .eq('school_id', a.school_id)
      .eq('status', 'completed')
      .gte('date', monthStart)
      .lte('date', monthEnd)
      .order('date')

    let total = 0
    let bonusLessons = 0
    const lessonDetails = (lessons ?? []).map(l => {
      const plan = getPlan(l.compensation_plan_id)
      const students = l.current_bookings ?? 0
      let fee = 0
      let hasBonus = false

      if (plan) {
        const result = calcFee(plan, students)
        fee = result.fee
        hasBonus = result.hasBonus
        if (hasBonus) bonusLessons++
      }

      total += fee
      return {
        id: l.id,
        date: l.date,
        start_time: l.start_time,
        course: (l.courses as unknown as { name: string } | null)?.name,
        plan_name: plan?.name ?? null,
        students,
        fee,
        has_bonus: hasBonus,
        threshold_gap: plan && students < plan.bonus_threshold ? plan.bonus_threshold - students : 0,
      }
    })

    result.push({
      school,
      plan: null, // deprecated — plan is now per-course, not per-school
      lessons: lessonDetails,
      total,
      bonus_lessons: bonusLessons,
      payment,
    })
  }

  return NextResponse.json({ month: targetMonth, entries: result, trend: trendMonths })
}
