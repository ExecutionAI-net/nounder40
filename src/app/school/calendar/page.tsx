import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import CalendarClient, { type Lesson, type TeacherOption, type StudentOption, type CourseOption } from './CalendarClient'

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

/** Returns Monday–Sunday ISO strings for the current week */
function getCurrentWeekRange(): { from: string; to: string } {
  const today = new Date()
  const day = today.getDay()
  const monday = new Date(today)
  monday.setDate(today.getDate() - ((day + 6) % 7))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const toISO = (d: Date) => d.toISOString().split('T')[0]
  return { from: toISO(monday), to: toISO(sunday) }
}

export default async function CalendarPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('school_id')
    .eq('id', user.id)
    .single()

  if (!profile?.school_id) {
    return <CalendarClient initialLessons={[]} teacherOptions={[]} studentOptions={[]} initialCourses={[]} />
  }

  const schoolId = profile.school_id
  const { from, to } = getCurrentWeekRange()
  const db = adminClient()

  const [lessonsRes, teachersRes, studentsRes, coursesRes] = await Promise.all([
    // Current week's lessons — direct Supabase query, no round-trip through API
    supabase
      .from('lessons')
      .select(`
        id, date, start_time, end_time, max_capacity, current_bookings, status,
        course_id,
        courses(name, color, credit_cost),
        lesson_types(name_en),
        teachers(name),
        school_rooms(name, school_locations(name))
      `)
      .eq('school_id', schoolId)
      .neq('status', 'cancelled')
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true })
      .order('start_time', { ascending: true }),

    // Teachers for filter dropdown
    db
      .from('teacher_schools')
      .select('teachers(id, name)')
      .eq('school_id', schoolId)
      .eq('active', true),

    // Students for filter dropdown (needs admin — students table has strict RLS)
    db
      .from('school_students')
      .select('student_id, students(user_id, name)')
      .eq('school_id', schoolId),

    // Courses for "Add Class" modal
    supabase
      .from('courses')
      .select('id, name, color')
      .eq('school_id', schoolId)
      .eq('active', true)
      .order('name'),
  ])

  const teacherOptions: TeacherOption[] = (teachersRes.data ?? [])
    .map(r => {
      const t = Array.isArray(r.teachers) ? r.teachers[0] : r.teachers
      return t ? { id: t.id, name: t.name } : null
    })
    .filter(Boolean) as TeacherOption[]

  const studentOptions: StudentOption[] = (studentsRes.data ?? [])
    .map(r => {
      const s = Array.isArray(r.students) ? r.students[0] : r.students
      return s ? { userId: s.user_id, name: s.name } : null
    })
    .filter(Boolean) as StudentOption[]

  const initialCourses: CourseOption[] = (coursesRes.data ?? []).map(c => ({
    id: c.id,
    name: c.name,
    color: c.color,
  }))

  return (
    <CalendarClient
      initialLessons={(lessonsRes.data ?? []) as unknown as Lesson[]}
      teacherOptions={teacherOptions}
      studentOptions={studentOptions}
      initialCourses={initialCourses}
    />
  )
}
