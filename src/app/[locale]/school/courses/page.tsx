import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import CoursesClient, { type Course, type ScheduleSummary } from './CoursesClient'

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

  // La lingua del profilo scuola decide la lingua dei nomi tipo lezione
  const { data: schoolRow } = await supabase.from('schools').select('language').eq('id', schoolId).single()
  const schoolLang = schoolRow?.language ?? 'it'

  // 1. Fetch courses — ordina per sort_order (frecce su/giù); se la colonna
  // non esiste ancora (migrazione 055) fallback sull'ordine per data
  const courseCols = `
      id, name, color, frequency, start_time, duration_minutes,
      start_date, end_date, active, notes,
      lesson_types(name_en, name_it, name_es),
      teachers(name)
    `
  let coursesRaw
  {
    const first = await supabase
      .from('courses')
      .select(courseCols)
      .eq('school_id', schoolId)
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('start_date', { ascending: false })
    if (!first.error) coursesRaw = first.data
    else {
      const fb = await supabase
        .from('courses')
        .select(courseCols)
        .eq('school_id', schoolId)
        .order('start_date', { ascending: false })
      coursesRaw = fb.data
    }
  }

  const courseIds = (coursesRaw ?? []).map(c => c.id)

  // 2. Fetch upcoming lessons, teacher names, room→location, and lesson types in parallel
  type LessonRow = {
    course_id: string; date: string; start_time: string | null; end_time: string | null
    teacher_id: string | null; room_id: string | null; max_capacity: number | null
    is_online: boolean | null; color: string | null
  }
  // Prova a leggere anche lessons.color (migrazione 053); se la colonna non esiste
  // ancora, fallback senza colore → i chip usano il colore del corso.
  const loadLessons = async (): Promise<LessonRow[]> => {
    if (courseIds.length === 0) return []
    const query = (cols: string) => fetchAllRows<LessonRow>((from, to) => supabase
      .from('lessons')
      .select(cols)
      .in('course_id', courseIds)
      .gte('date', today)
      .neq('status', 'cancelled')
      .order('date', { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: LessonRow[] | null; error?: { message: string } | null }>)
    try {
      return await query('course_id, date, start_time, end_time, teacher_id, room_id, max_capacity, is_online, color')
    } catch {
      const rows = await query('course_id, date, start_time, end_time, teacher_id, room_id, max_capacity, is_online')
      return rows.map(l => ({ ...l, color: null }))
    }
  }
  const [lessonsData, teachersRes, roomsRes, lessonTypesRes] = await Promise.all([
    loadLessons(),
    supabase
      .from('teachers')
      .select('id, name')
      .eq('school_id', schoolId),
    // school_rooms NON ha school_id: si filtra passando dalla sede
    supabase
      .from('school_rooms')
      .select('id, name, location_id, school_locations!inner(name, school_id)')
      .eq('school_locations.school_id', schoolId),
    supabase
      .from('lesson_types')
      .select('*')
      .eq('active', true),
  ])

  const teacherMap: Record<string, string> = {}
  for (const t of teachersRes.data ?? []) teacherMap[t.id] = t.name

  // Per ogni sala: nome sede + nome sala (mostrati entrambi in tabella)
  const roomMap: Record<string, { room: string; location: string | null }> = {}
  for (const r of roomsRes.data ?? []) {
    const loc = r.school_locations as unknown as { name: string } | null
    roomMap[r.id] = { room: r.name, location: loc?.name ?? null }
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
    const roomInfo = roomId ? (roomMap[roomId] ?? null) : null
    const locationName = roomInfo?.location ?? null
    const roomName = roomInfo?.room ?? null

    const existing = schedulesByCourse[lesson.course_id].find(s =>
      s.weekday === weekday &&
      s.start_time === lesson.start_time?.slice(0, 5) &&
      s.teacher_id === teacherId &&
      s.location_name === locationName &&
      s.room_name === roomName
    )

    const [sh, sm] = (lesson.start_time ?? '').split(':').map(Number)
    const [eh, em] = (lesson.end_time ?? '').split(':').map(Number)
    const dur = (eh * 60 + em) - (sh * 60 + sm)

    if (existing) {
      existing.class_count++
      existing.last_date = lesson.date
      if (!existing.color && lesson.color) existing.color = lesson.color
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
        room_name: roomName,
        max_capacity: lesson.max_capacity ?? null,
        is_online: lesson.is_online ?? null,
        color: lesson.color ?? null,
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
      initialLessonTypes={((lessonTypesRes.data ?? []) as { id: string; name_en: string; name_it: string; name_es?: string | null; sort_order?: number | null }[])
        .sort((a, b) => ((a.sort_order ?? 1e9) - (b.sort_order ?? 1e9)) || (a.name_en ?? '').localeCompare(b.name_en ?? ''))}
      initialTeachers={teachersRes.data ?? []}
      schoolLang={schoolLang}
    />
  )
}
