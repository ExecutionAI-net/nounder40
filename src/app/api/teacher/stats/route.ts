import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

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

  const today = new Date().toISOString().split('T')[0]
  const thisMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]

  // Today's lessons
  const { count: todayCount } = await supabase
    .from('lessons')
    .select('id', { count: 'exact', head: true })
    .eq('teacher_id', teacher.id)
    .eq('date', today)
    .eq('status', 'scheduled')

  // This week's lessons
  const weekStart = new Date()
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1)
  const { count: weekCount } = await supabase
    .from('lessons')
    .select('id', { count: 'exact', head: true })
    .eq('teacher_id', teacher.id)
    .gte('date', weekStart.toISOString().split('T')[0])
    .lte('date', today)
    .in('status', ['scheduled', 'completed'])

  // Attendance this month
  const { data: attendanceData } = await supabase
    .from('attendance')
    .select('status')
    .eq('teacher_id', teacher.id)
    .gte('marked_at', thisMonthStart)

  const totalMarked = attendanceData?.length ?? 0
  const presentCount = attendanceData?.filter(a => a.status === 'present').length ?? 0
  const attendanceRate = totalMarked > 0 ? Math.round((presentCount / totalMarked) * 100) : 0

  // Unique students this month
  const { data: studentData } = await supabase
    .from('attendance')
    .select('student_id')
    .eq('teacher_id', teacher.id)
    .gte('marked_at', thisMonthStart)

  const uniqueStudents = new Set(studentData?.map(a => a.student_id) ?? []).size

  return NextResponse.json({
    today_lessons: todayCount ?? 0,
    week_lessons: weekCount ?? 0,
    students_this_month: uniqueStudents,
    attendance_rate: attendanceRate,
  })
}
