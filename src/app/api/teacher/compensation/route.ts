import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: teacher } = await supabase
    .from('teachers')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!teacher) return NextResponse.json({ error: 'Teacher not found' }, { status: 404 })

  // Get teacher-school assignments with compensation plans
  const { data: assignments, error: assignErr } = await supabase
    .from('teacher_schools')
    .select(`
      school_id,
      schools(name, city),
      compensation_plans(id, name, base_fee, bonus_threshold, bonus_per_student)
    `)
    .eq('teacher_id', teacher.id)

  if (assignErr) console.error('[teacher/compensation] assignments error:', assignErr.message)

  const thisMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]

  // For each school, calculate this month's compensation
  const result = []
  for (const a of assignments ?? []) {
    const plan = a.compensation_plans as unknown as {
      id: string; name: string; base_fee: number; bonus_threshold: number; bonus_per_student: number
    } | null
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
