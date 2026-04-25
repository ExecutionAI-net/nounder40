import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import CoursesClient, { type Course, type ScheduleSummary } from './CoursesClient'

export const dynamic = 'force-dynamic'

const JS_DAY_TO_WEEKDAY = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

export default async function CoursesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('school_id')
    .eq('id', user.id)
    .single()

  if (!profile?.school_id) {
    return <CoursesClient initialCourses={[]} />
  }

  const schoolId = profile.school_id
  const today = new Date().toISOString().split('T')[0]

  // 1. Fetch courses
  const { data: coursesRaw } = await supabase
    .from('courses')
    .select(`
      id, name, color, frequency, start_time, duration_minutes,
      start_date, end_date, active, notes,
      lesson_types(name_en, name_it),
      teachers(name)
    `)
    .eq('school_id', schoolId)
    .order('start_date', { ascending: false })

  const courseIds = (coursesRaw ?? []).map(c => c.id)

  // 2. Fetch upcoming lessons, teacher names, room→location, and lesson types in parallel
  const [lessonsRes, teachersRes, roomsRes, lessonTypesRes] = await Promise.all([
    courseIds.length > 0
      ? supabase
          .from('lessons')
          .select('course_id, date, start_time, end_time, teacher_id, room_id')
          .in('course_id', courseIds)
          .gte('date', today)
          .neq('status', 'cancelled')
          .order('date', { ascending: true })
      : Promise.resolve({ data: [] }),
    supabase
      .from('teachers')
      .select('id, name')
      .eq('school_id', schoolId),
    supabase
      .from('school_rooms')
      .select('id, name, location_id, school_locations(name)')
      .eq('school_id', schoolId),
    supabase
      .from('lesson_types')
      .select('id, name_en, name_it')
      .eq('active', true)
      .order('name_en'),
  ])

  const lessonsData = lessonsRes.data ?? []
  const teacherMap: Record<string, string> = {}
  for (const t of teachersRes.data ?? []) teacherMap[t.id] = t.name

  const roomLocationMap: Record<string, string> = {}
  for (const r of roomsRes.data ?? []) {
    const loc = r.school_locations as unknown as { name: string } | null
    roomLocationMap[r.id] = loc?.name ?? r.name
  }

  // 3. Build schedule summaries per course
  const schedulesByCourse: Record<string, ScheduleSummary[]> = {}
  for (const lesson of lessonsData) {
    const jsDay = new Date(lesson.date + 'T12:00:00').getDay()
    const weekday = JS_DAY_TO_WEEKDAY[jsDay]
    const teacherId = lesson.teacher_id ?? null

    if (!schedulesByCourse[lesson.course_id]) {
      schedulesByCourse[lesson.course_id] = []
    }

    const roomId = lesson.room_id ?? null
    const locationName = roomId ? (roomLocationMap[roomId] ?? null) : null

    const existing = schedulesByCourse[lesson.course_id].find(s =>
      s.weekday === weekday &&
      s.start_time === lesson.start_time?.slice(0, 5) &&
      s.teacher_id === teacherId &&
      s.location_name === locationName
    )

    const [sh, sm] = (lesson.start_time ?? '').split(':').map(Number)
    const [eh, em] = (lesson.end_time ?? '').split(':').map(Number)
    const dur = (eh * 60 + em) - (sh * 60 + sm)

    if (existing) {
      existing.class_count++
      existing.last_date = lesson.date
    } else {
      schedulesByCourse[lesson.course_id].push({
        weekday,
        start_time: lesson.start_time?.slice(0, 5) ?? '',
        duration_minutes: dur > 0 ? dur : 60,
        class_count: 1,
        first_date: lesson.date,
        last_date: lesson.date,
        teacher_id: teacherId,
        teacher_name: teacherId ? (teacherMap[teacherId] ?? null) : null,
        location_name: locationName,
      })
    }
  }

  const courses: Course[] = (coursesRaw ?? []).map(c => ({
    ...c,
    lesson_types: Array.isArray(c.lesson_types) ? c.lesson_types[0] ?? null : c.lesson_types,
    teachers: Array.isArray(c.teachers) ? c.teachers[0] ?? null : c.teachers,
    _schedules: schedulesByCourse[c.id] ?? [],
  }))

  return (
    <CoursesClient
      initialCourses={courses}
      initialLessonTypes={lessonTypesRes.data ?? []}
      initialTeachers={teachersRes.data ?? []}
    />
  )
}
