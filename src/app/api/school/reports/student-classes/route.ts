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

  if (!profile?.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const schoolId = profile.school_id

  // 1. Get students enrolled in this school
  const { data: schoolStudentsRaw } = await supabase
    .from('school_students')
    .select('student_id')
    .eq('school_id', schoolId)

  const userIds = (schoolStudentsRaw ?? []).map((ss) => ss.student_id)

  const { data: studentsRaw } = userIds.length
    ? await supabase.from('students').select('id, user_id, name').in('user_id', userIds)
    : { data: [] }

  const userToStudentId: Record<string, string> = {}
  const studentIdToName: Record<string, string> = {}
  for (const s of studentsRaw ?? []) {
    userToStudentId[s.user_id] = s.id
    studentIdToName[s.id] = s.name ?? '—'
  }
  const studentIds = Object.values(userToStudentId)

  // 2. Get all attendance records with lesson info for these students
  const { data: attendanceRaw } = studentIds.length
    ? await supabase
        .from('attendance')
        .select('student_id, lesson_id, status, marked_at')
        .in('student_id', studentIds)
        .order('marked_at', { ascending: false })
    : { data: [] }

  const lessonIds = [...new Set((attendanceRaw ?? []).map((a) => a.lesson_id))]

  // 3. Fetch lesson details
  const { data: lessonsRaw } = lessonIds.length
    ? await supabase
        .from('lessons')
        .select(`
          id, date, start_time,
          courses(name),
          teachers(id, name),
          school_rooms(id, name, school_locations(id, name))
        `)
        .in('id', lessonIds)
    : { data: [] }

  const lessonMap: Record<string, {
    date: string; start_time: string; course_name: string
    teacher_id: string | null; teacher_name: string
    room_id: string | null; room_name: string
    location_id: string | null; location_name: string
  }> = {}

  for (const l of lessonsRaw ?? []) {
    const teacher = l.teachers as { id?: string; name?: string } | null
    const room = l.school_rooms as { id?: string; name?: string; school_locations?: { id?: string; name?: string } | null } | null
    lessonMap[l.id] = {
      date: l.date,
      start_time: l.start_time?.slice(0, 5) ?? '',
      course_name: (l.courses as { name?: string } | null)?.name ?? '—',
      teacher_id: teacher?.id ?? null,
      teacher_name: teacher?.name ?? '—',
      room_id: room?.id ?? null,
      room_name: room?.name ?? '—',
      location_id: room?.school_locations?.id ?? null,
      location_name: room?.school_locations?.name ?? '—',
    }
  }

  // 4. Get bookings (credits_deducted, package info) for these students
  const { data: bookingsRaw } = studentIds.length
    ? await supabase
        .from('bookings')
        .select('student_id, lesson_id, credits_deducted, access_source, student_package_id')
        .eq('school_id', schoolId)
        .in('student_id', studentIds)
        .in('status', ['confirmed', 'attended'])
    : { data: [] }

  const bookingByLessonStudent: Record<string, { credits_deducted: number; access_source: string }> = {}
  for (const b of bookingsRaw ?? []) {
    bookingByLessonStudent[`${b.student_id}__${b.lesson_id}`] = {
      credits_deducted: b.credits_deducted ?? 0,
      access_source: b.access_source ?? '—',
    }
  }

  // 5. Get active packages per student
  const { data: packagesRaw } = studentIds.length
    ? await supabase
        .from('student_packages')
        .select('id, student_id, credits_remaining, credits_total, expires_at, status')
        .eq('school_id', schoolId)
        .in('student_id', studentIds)
        .order('expires_at', { ascending: false })
    : { data: [] }

  type PackageSummary = { id: string; credits_remaining: number; credits_total: number; expires_at: string; status: string }
  const packagesByStudent: Record<string, PackageSummary[]> = {}
  for (const p of packagesRaw ?? []) {
    if (!packagesByStudent[p.student_id]) packagesByStudent[p.student_id] = []
    packagesByStudent[p.student_id].push({
      id: p.id,
      credits_remaining: p.credits_remaining ?? 0,
      credits_total: p.credits_total ?? 0,
      expires_at: p.expires_at ?? '',
      status: p.status ?? '',
    })
  }

  // 6. Build per-student attendance rows
  const attByStudent: Record<string, {
    lesson_id: string; date: string; start_time: string; course_name: string
    teacher_id: string | null; teacher_name: string
    room_id: string | null; room_name: string
    location_id: string | null; location_name: string
    status: string; credits_deducted: number; access_source: string
  }[]> = {}

  for (const a of attendanceRaw ?? []) {
    const lesson = lessonMap[a.lesson_id]
    if (!lesson) continue
    if (!attByStudent[a.student_id]) attByStudent[a.student_id] = []
    const bk = bookingByLessonStudent[`${a.student_id}__${a.lesson_id}`]
    attByStudent[a.student_id].push({
      lesson_id: a.lesson_id,
      date: lesson.date,
      start_time: lesson.start_time,
      course_name: lesson.course_name,
      teacher_id: lesson.teacher_id,
      teacher_name: lesson.teacher_name,
      room_id: lesson.room_id,
      room_name: lesson.room_name,
      location_id: lesson.location_id,
      location_name: lesson.location_name,
      status: a.status,
      credits_deducted: bk?.credits_deducted ?? 0,
      access_source: bk?.access_source ?? '—',
    })
  }

  // 7. Build final rows
  const rows = studentIds.map((sid) => ({
    student_id: sid,
    student_name: studentIdToName[sid] ?? '—',
    packages: packagesByStudent[sid] ?? [],
    attendance: attByStudent[sid] ?? [],
  }))

  return NextResponse.json({ rows })
}
