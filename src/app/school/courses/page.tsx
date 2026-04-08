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
  lesson_types: { name_en: string } | null
  teachers: { name: string } | null
  _class_count?: number
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
        lesson_types(name_en),
        teachers(name)
      `)
      .eq('school_id', profile.school_id)
      .order('start_date', { ascending: false })

    // Count future classes per course
    const today = new Date().toISOString().split('T')[0]
    const courseIds = (data ?? []).map(c => c.id)
    let countMap: Record<string, number> = {}

    if (courseIds.length > 0) {
      const { data: counts } = await supabase
        .from('lessons')
        .select('course_id')
        .in('course_id', courseIds)
        .gte('date', today)
        .neq('status', 'cancelled')

      for (const row of counts ?? []) {
        countMap[row.course_id] = (countMap[row.course_id] ?? 0) + 1
      }
    }

    setCourses((data ?? []).map(c => ({ ...c, _class_count: countMap[c.id] ?? 0 })))
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
    single: 'Single',
    weekly: 'Weekly',
    biweekly: 'Bi-weekly',
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
          {courses.map(course => (
            <div key={course.id} className="px-5 py-4 flex items-center gap-4">
              {/* Color dot */}
              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: course.color }} />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900 truncate">{course.name}</span>
                  <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded shrink-0">
                    {course.lesson_types?.name_en ?? '—'}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400 flex-wrap">
                  <span>{freqLabel[course.frequency] ?? course.frequency}</span>
                  <span>·</span>
                  <span>{course.start_time?.slice(0, 5)} · {course.duration_minutes}min</span>
                  {course.teachers?.name && (
                    <>
                      <span>·</span>
                      <span>{course.teachers.name}</span>
                    </>
                  )}
                  <span>·</span>
                  <span className="font-medium text-gray-600">{course._class_count} upcoming classes</span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
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
          ))}
        </div>
      )}
    </div>
  )
}
