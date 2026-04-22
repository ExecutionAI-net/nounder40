import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('school_id')
    .eq('id', user.id)
    .single()

  const school = profile?.school_id ? { id: profile.school_id } : null
  if (!school) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const schoolId = school.id
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const monthStartDate = monthStart.slice(0, 10)

  // ── Lessons tab data ────────────────────────────────────────────────────────
  const { data: lessonsRaw } = await supabase
    .from('lessons')
    .select(`
      id, date, start_time, end_time, max_capacity, current_bookings, status,
      courses(name),
      teachers(id, name),
      school_rooms(id, name, cost, school_locations(id, name)),
      compensation_plans(id, name)
    `)
    .eq('school_id', schoolId)
    .order('date', { ascending: false })
    .limit(500)

  const lessonIds = (lessonsRaw ?? []).map((l) => l.id)

  // Fetch attendance for those lessons
  const { data: attendanceRaw } = lessonIds.length
    ? await supabase
        .from('attendance')
        .select('lesson_id, status')
        .in('lesson_id', lessonIds)
    : { data: [] }

  const attendanceByLesson: Record<string, { present: number; no_show: number }> = {}
  for (const a of attendanceRaw ?? []) {
    if (!attendanceByLesson[a.lesson_id]) attendanceByLesson[a.lesson_id] = { present: 0, no_show: 0 }
    if (a.status === 'present') attendanceByLesson[a.lesson_id].present++
    else if (a.status === 'no_show') attendanceByLesson[a.lesson_id].no_show++
  }

  const { data: cancelledBookingsRaw } = lessonIds.length
    ? await supabase
        .from('bookings')
        .select('lesson_id')
        .in('lesson_id', lessonIds)
        .eq('status', 'cancelled')
    : { data: [] }

  const cancelledByLesson: Record<string, number> = {}
  for (const b of cancelledBookingsRaw ?? []) {
    cancelledByLesson[b.lesson_id] = (cancelledByLesson[b.lesson_id] ?? 0) + 1
  }

  const lessonRows = (lessonsRaw ?? []).map((l) => {
    const att = attendanceByLesson[l.id] ?? { present: 0, no_show: 0 }
    const cancelled = cancelledByLesson[l.id] ?? 0
    const room = l.school_rooms as { id?: string; name?: string; cost?: number; school_locations?: { id?: string; name?: string } | null } | null
    const teacher = l.teachers as { id?: string; name?: string } | null
    const plan = l.compensation_plans as { id?: string; name?: string } | null
    return {
      id: l.id,
      name: (l.courses as { name?: string } | null)?.name ?? '—',
      date: l.date,
      teacher: teacher?.name ?? '—',
      teacher_id: teacher?.id ?? null,
      room: room?.name ?? '—',
      room_id: room?.id ?? null,
      room_cost: room?.cost ?? null,
      location: room?.school_locations?.name ?? '—',
      location_id: room?.school_locations?.id ?? null,
      compensation_plan: plan?.name ?? '—',
      compensation_plan_id: plan?.id ?? null,
      capacity: l.max_capacity ?? 0,
      booked: l.current_bookings ?? 0,
      attended: att.present,
      no_shows: att.no_show,
      cancelled,
      status: l.status,
    }
  })

  const totalAttendance = lessonRows.reduce((s, r) => s + r.attended, 0)
  const totalNoShows = lessonRows.reduce((s, r) => s + r.no_shows, 0)
  const totalCancellations = lessonRows.reduce((s, r) => s + r.cancelled, 0)
  const totalBooked = lessonRows.reduce((s, r) => s + r.booked, 0)
  const noShowRate = totalBooked > 0 ? ((totalNoShows / totalBooked) * 100).toFixed(1) : '0.0'
  const cancellationRate = totalBooked > 0 ? ((totalCancellations / (totalBooked + totalCancellations)) * 100).toFixed(1) : '0.0'

  // ── Students tab data ───────────────────────────────────────────────────────
  const { data: schoolStudentsRaw } = await supabase
    .from('school_students')
    .select('student_id, enrolled_at')
    .eq('school_id', schoolId)

  // school_students.student_id = auth.users.id = students.user_id (NOT students.id)
  const userIds = (schoolStudentsRaw ?? []).map((ss) => ss.student_id)

  const { data: studentsRaw } = userIds.length
    ? await supabase
        .from('students')
        .select('id, user_id, name')
        .in('user_id', userIds)
    : { data: [] }

  // Build map: user_id -> students.id for downstream lookups
  const userToStudentId: Record<string, string> = {}
  for (const s of studentsRaw ?? []) userToStudentId[s.user_id] = s.id
  const studentIds = Object.values(userToStudentId)

  // Get credit balances (latest active package per student)
  const { data: packagesRaw } = studentIds.length
    ? await supabase
        .from('student_packages')
        .select('student_id, credits_remaining, expires_at, status')
        .eq('school_id', schoolId)
        .eq('status', 'active')
        .in('student_id', studentIds)
    : { data: [] }

  const creditsByStudent: Record<string, number> = {}
  for (const p of packagesRaw ?? []) {
    creditsByStudent[p.student_id] = (creditsByStudent[p.student_id] ?? 0) + (p.credits_remaining ?? 0)
  }

  // Last attendance per student
  const { data: lastAttRaw } = studentIds.length
    ? await supabase
        .from('attendance')
        .select('student_id, marked_at, status, lesson_id')
        .in('student_id', studentIds)
        .eq('status', 'present')
        .order('marked_at', { ascending: false })
    : { data: [] }

  const lastAttByStudent: Record<string, string> = {}
  const totalAttByStudent: Record<string, number> = {}
  for (const a of lastAttRaw ?? []) {
    if (!lastAttByStudent[a.student_id]) lastAttByStudent[a.student_id] = a.marked_at
    totalAttByStudent[a.student_id] = (totalAttByStudent[a.student_id] ?? 0) + 1
  }

  // Credits burned = credits_deducted sum from confirmed/attended bookings
  const { data: burnedRaw } = studentIds.length
    ? await supabase
        .from('bookings')
        .select('student_id, credits_deducted')
        .eq('school_id', schoolId)
        .in('student_id', studentIds)
        .in('status', ['confirmed', 'attended'])
    : { data: [] }

  const creditsBurnedByStudent: Record<string, number> = {}
  for (const b of burnedRaw ?? []) {
    creditsBurnedByStudent[b.student_id] = (creditsBurnedByStudent[b.student_id] ?? 0) + (b.credits_deducted ?? 0)
  }

  // Expired documents count
  const { count: expiredDocs } = await supabase
    .from('student_documents')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('status', 'expired')

  const studentRows = (studentsRaw ?? []).map((s) => ({
    id: s.id,
    name: s.name ?? '—',
    credits_remaining: creditsByStudent[s.id] ?? 0,
    credits_burned: creditsBurnedByStudent[s.id] ?? 0,
    last_attendance: lastAttByStudent[s.id]
      ? new Date(lastAttByStudent[s.id]).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      : '—',
    total_attended: totalAttByStudent[s.id] ?? 0,
    has_active_package: (creditsByStudent[s.id] ?? 0) > 0,
  }))

  const avgCredits = studentRows.length > 0
    ? (studentRows.reduce((s, r) => s + r.credits_remaining, 0) / studentRows.length).toFixed(1)
    : '0'

  // ── Teachers tab data ────────────────────────────────────────────────────────
  const { data: teacherSchoolsRaw } = await supabase
    .from('teacher_schools')
    .select('teacher_id, compensation_plan_id')
    .eq('school_id', schoolId)
    .eq('active', true)

  const teacherSchoolMap: Record<string, string | null> = {}
  for (const ts of teacherSchoolsRaw ?? []) {
    teacherSchoolMap[ts.teacher_id] = ts.compensation_plan_id ?? null
  }
  const teacherIds = Object.keys(teacherSchoolMap)

  const { data: teachersRaw } = teacherIds.length
    ? await supabase
        .from('teachers')
        .select('id, name')
        .in('id', teacherIds)
    : { data: [] }

  // Lessons this month per teacher
  const { data: teacherLessonsRaw } = teacherIds.length
    ? await supabase
        .from('lessons')
        .select('id, teacher_id, current_bookings')
        .eq('school_id', schoolId)
        .in('teacher_id', teacherIds)
        .gte('date', monthStartDate)
        .eq('status', 'completed')
    : { data: [] }

  const lessonsByTeacher: Record<string, { count: number; totalStudents: number }> = {}
  for (const l of teacherLessonsRaw ?? []) {
    if (!lessonsByTeacher[l.teacher_id]) lessonsByTeacher[l.teacher_id] = { count: 0, totalStudents: 0 }
    lessonsByTeacher[l.teacher_id].count++
    lessonsByTeacher[l.teacher_id].totalStudents += l.current_bookings ?? 0
  }

  // Attendance rate per teacher (this month)
  const teacherLessonIds = (teacherLessonsRaw ?? []).map((l) => l.id)
  const { data: teacherAttRaw } = teacherLessonIds.length
    ? await supabase
        .from('attendance')
        .select('lesson_id, status, teacher_id')
        .in('lesson_id', teacherLessonIds)
    : { data: [] }

  const attStatsByTeacher: Record<string, { present: number; no_show: number }> = {}
  for (const a of teacherAttRaw ?? []) {
    if (!attStatsByTeacher[a.teacher_id]) attStatsByTeacher[a.teacher_id] = { present: 0, no_show: 0 }
    if (a.status === 'present') attStatsByTeacher[a.teacher_id].present++
    else if (a.status === 'no_show') attStatsByTeacher[a.teacher_id].no_show++
  }

  // Compensation plans
  const planIds = [...new Set(Object.values(teacherSchoolMap).filter(Boolean))] as string[]
  const { data: plansRaw } = planIds.length
    ? await supabase
        .from('compensation_plans')
        .select('id, base_fee, bonus_threshold, bonus_per_student')
        .in('id', planIds)
    : { data: [] }

  const plansById: Record<string, { base_fee: number; bonus_threshold: number; bonus_per_student: number }> = {}
  for (const p of plansRaw ?? []) {
    plansById[p.id] = { base_fee: p.base_fee ?? 0, bonus_threshold: p.bonus_threshold ?? 0, bonus_per_student: p.bonus_per_student ?? 0 }
  }

  const teacherRows = (teachersRaw ?? []).map((t) => {
    const tLessons = lessonsByTeacher[t.id] ?? { count: 0, totalStudents: 0 }
    const tAtt = attStatsByTeacher[t.id] ?? { present: 0, no_show: 0 }
    const total = tAtt.present + tAtt.no_show
    const attRate = total > 0 ? ((tAtt.present / total) * 100).toFixed(1) : '—'

    const planId = teacherSchoolMap[t.id]
    let compEstimate = 0
    if (planId && plansById[planId]) {
      const plan = plansById[planId]
      const avgStudents = tLessons.count > 0 ? tLessons.totalStudents / tLessons.count : 0
      const bonus = avgStudents > plan.bonus_threshold ? (avgStudents - plan.bonus_threshold) * plan.bonus_per_student : 0
      compEstimate = tLessons.count * (plan.base_fee + bonus)
    }

    return {
      id: t.id,
      name: t.name ?? '—',
      lessons_this_month: tLessons.count,
      total_students: tLessons.totalStudents,
      attendance_rate: attRate,
      compensation_estimate: compEstimate,
    }
  })

  return NextResponse.json({
    lessons: {
      total: lessonRows.length,
      total_attendance: totalAttendance,
      no_show_rate: noShowRate,
      cancellation_rate: cancellationRate,
      rows: lessonRows,
    },
    students: {
      total: studentRows.length,
      avg_credits: avgCredits,
      docs_expired: expiredDocs ?? 0,
      rows: studentRows,
    },
    teachers: {
      rows: teacherRows,
    },
  })
}
