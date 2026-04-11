'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

interface Course {
  id: string
  name: string
  color: string
  frequency: string
  start_time: string
  duration_minutes: number
  start_date: string
  end_date: string | null
  active: boolean
  lesson_types: { name_en: string; name_it: string } | null
  teachers: { name: string } | null
  _schedules: ScheduleSummary[]
}

interface ScheduleSummary {
  weekday: string
  start_time: string
  duration_minutes: number
  class_count: number
  first_date: string
  last_date: string
}

const WEEKDAY_LABELS: Record<string, string> = {
  monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday',
  thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday',
}
const JS_DAY_TO_WEEKDAY = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']

function fmtDate(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export default function CoursesPage() {
  const supabase = createClient()
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadCourses()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadCourses() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
    if (!profile?.school_id) return

    const { data } = await supabase
      .from('courses')
      .select(`
        id, name, color, frequency, start_time, duration_minutes,
        start_date, end_date, active,
        lesson_types(name_en, name_it),
        teachers(name)
      `)
      .eq('school_id', profile.school_id)
      .order('start_date', { ascending: false })

    const today = new Date().toISOString().split('T')[0]
    const courseIds = (data ?? []).map(c => c.id)

    // Fetch all future lessons for all courses in one query
    let lessonsData: { course_id: string; date: string; start_time: string; end_time: string }[] = []
    if (courseIds.length > 0) {
      const { data: lessons } = await supabase
        .from('lessons')
        .select('course_id, date, start_time, end_time')
        .in('course_id', courseIds)
        .gte('date', today)
        .neq('status', 'cancelled')
        .order('date', { ascending: true })
      lessonsData = lessons ?? []
    }

    // Group lessons by course, then by weekday+start_time
    const schedulesByCourse: Record<string, ScheduleSummary[]> = {}

    for (const lesson of lessonsData) {
      const jsDay = new Date(lesson.date + 'T12:00:00').getDay()
      const weekday = JS_DAY_TO_WEEKDAY[jsDay]
      const key = `${weekday}|${lesson.start_time?.slice(0, 5)}`

      if (!schedulesByCourse[lesson.course_id]) {
        schedulesByCourse[lesson.course_id] = []
      }

      const existing = schedulesByCourse[lesson.course_id].find(s =>
        s.weekday === weekday && s.start_time === lesson.start_time?.slice(0, 5)
      )

      // Duration from start/end
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
        })
      }
      void key // suppress unused warning
    }

    setCourses((data ?? []).map(c => ({
      ...c,
      _schedules: schedulesByCourse[c.id] ?? [],
    })))
    setLoading(false)
  }

  async function handleDelete(courseId: string, courseName: string) {
    if (!confirm(`Delete "${courseName}"?\n\nAll future classes will be cancelled and students refunded. Past classes are kept.`)) return
    setDeletingId(courseId)
    setError(null)
    const res = await fetch(`/api/school/courses/${courseId}`, { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error)
      setDeletingId(null)
      return
    }
    setCourses(prev => prev.filter(c => c.id !== courseId))
    setDeletingId(null)
  }

  const freqLabel: Record<string, string> = {
    single: 'Single', weekly: 'Weekly', biweekly: 'Bi-weekly',
  }

  if (loading) return <div className="text-sm text-gray-400">Loading...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Courses</h1>
          <p className="text-gray-500 text-sm mt-1">Manage your courses and their classes.</p>
        </div>
        <Link
          href="/school/courses/new"
          className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700 transition"
        >
          + New Course
        </Link>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
      )}

      {courses.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
          <p className="text-gray-400 text-sm">No courses yet.</p>
          <Link href="/school/courses/new" className="mt-3 inline-block text-sm text-gray-900 font-medium underline">
            Create your first course
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
          {courses.map(course => {
            const totalClasses = course._schedules.reduce((s, sc) => s + sc.class_count, 0)
            return (
              <div key={course.id} className="px-5 py-4 flex items-start gap-4">
                {/* Color dot */}
                <div className="w-3 h-3 rounded-full shrink-0 mt-1" style={{ backgroundColor: course.color }} />

                <div className="flex-1 min-w-0">
                  {/* Course name + lesson type */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900">{course.name}</span>
                    <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded shrink-0">
                      {course.lesson_types?.name_it || course.lesson_types?.name_en || '—'}
                    </span>
                    <span className="text-xs text-gray-400 shrink-0">
                      {freqLabel[course.frequency] ?? course.frequency}
                    </span>
                    {course.teachers?.name && (
                      <span className="text-xs text-gray-400 shrink-0">· {course.teachers.name}</span>
                    )}
                    <span className="text-xs font-medium text-gray-500 shrink-0">
                      · {totalClasses} upcoming {totalClasses === 1 ? 'class' : 'classes'}
                    </span>
                  </div>

                  {/* Per-schedule breakdown */}
                  {course._schedules.length > 0 ? (
                    <div className="mt-2 space-y-1">
                      {course._schedules.map((sc, i) => (
                        <div key={i} className="flex items-center gap-2 flex-wrap">
                          <span
                            className="inline-flex items-center gap-1.5 text-xs bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1"
                          >
                            <span className="font-medium text-gray-700">{WEEKDAY_LABELS[sc.weekday] ?? sc.weekday}</span>
                            <span className="text-gray-300">·</span>
                            <span className="text-gray-500">{sc.start_time}</span>
                            <span className="text-gray-300">·</span>
                            <span className="text-gray-500">{sc.duration_minutes}min</span>
                            <span className="text-gray-300">·</span>
                            <span className="text-gray-500">{fmtDate(sc.first_date)} → {fmtDate(sc.last_date)}</span>
                            <span className="text-gray-300">·</span>
                            <span className="font-medium text-gray-600">{sc.class_count} {sc.class_count === 1 ? 'class' : 'classes'}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-300 mt-1">No upcoming classes</p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0 mt-0.5">
                  <Link
                    href={`/school/courses/${course.id}`}
                    className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition"
                  >
                    View Classes
                  </Link>
                  <Link
                    href={`/school/courses/${course.id}/edit`}
                    className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition"
                  >
                    Edit
                  </Link>
                  <button
                    onClick={() => handleDelete(course.id, course.name)}
                    disabled={deletingId === course.id}
                    className="text-xs px-3 py-1.5 rounded-lg border border-red-100 text-red-400 hover:bg-red-50 transition disabled:opacity-50"
                  >
                    {deletingId === course.id ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
