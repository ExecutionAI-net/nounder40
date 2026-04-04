import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: teacher, error: teacherErr } = await supabase
    .from('teachers')
    .select('id')
    .eq('user_id', user.id)
    .single()

  console.log('[teacher/compensation] user.id:', user.id, 'teacher:', teacher, 'err:', teacherErr?.message)

  if (!teacher) return NextResponse.json({ error: 'Teacher not found' }, { status: 404 })

  // Get teacher-school assignments
  const { data: assignments } = await supabase
    .from('teacher_schools')
    .select('school_id, compensation_plan_id, schools(name, city)')
    .eq('teacher_id', teacher.id)

  // Fetch compensation plans separately
  const planIds = (assignments ?? []).map(a => a.compensation_plan_id).filter(Boolean)
  const { data: plans } = planIds.length > 0
    ? await supabase.from('compensation_plans').select('id, name, base_fee, bonus_threshold, bonus_per_student').in('id', planIds)
    : { data: [] }

  const planMap: Record<string, { id: string; name: string; base_fee: number; bonus_threshold: number; bonus_per_student: number }> = {}
  for (const p of plans ?? []) planMap[p.id] = p

  console.log('[teacher/compensation] teacher.id:', teacher.id, 'assignments:', JSON.stringify(assignments), 'plans:', JSON.stringify(plans))

  const thisMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]

  // For each school, calculate this month's compensation
  const result = []
  for (const a of assignments ?? []) {
    const plan = a.compensation_plan_id ? (planMap[a.compensation_plan_id] ?? null) : null
    const school = a.schools as unknown as { name: string; city: string } | null

    if (!plan) {
      result.push({ school, plan: null, lessons: [], total: 0 })
      continue
    }

    // Get completed lessons this month at this school
    const { data: lessons } = await supabase
      .from('lessons')
      .select('id, date, start_time, current_bookings, courses(name)')
      .eq('teacher_id', teacher.id)
      .eq('school_id', a.school_id)
      .eq('status', 'completed')
      .gte('date', thisMonthStart)
      .order('date')

    let total = 0
    const lessonDetails = (lessons ?? []).map(l => {
      const students = l.current_bookings ?? 0
      let fee = plan.base_fee
      if (students > plan.bonus_threshold) {
        fee += (students - plan.bonus_threshold) * plan.bonus_per_student
      }
      total += fee
      return {
        id: l.id,
        date: l.date,
        start_time: l.start_time,
        course: (l.courses as unknown as { name: string } | null)?.name,
        students,
        fee,
      }
    })

    result.push({ school, plan, lessons: lessonDetails, total })
  }

  return NextResponse.json(result)
}
