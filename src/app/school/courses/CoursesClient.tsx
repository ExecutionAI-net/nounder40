'use client'

import Link from 'next/link'
import { useState } from 'react'

export interface ScheduleSummary {
  weekday: string
  start_time: string
  duration_minutes: number
  class_count: number
  first_date: string
  last_date: string
  teacher_id: string | null
  teacher_name: string | null
  location_name: string | null
}

export interface Course {
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

const WEEKDAY_LABELS: Record<string, string> = {
  monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday',
  thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday',
}

function fmtDate(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

const freqLabel: Record<string, string> = {
  single: 'Single', weekly: 'Weekly', biweekly: 'Bi-weekly',
}

export default function CoursesClient({ initialCourses }: { initialCourses: Course[] }) {
  const [courses, setCourses] = useState<Course[]>(initialCourses)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [showBulkConfirm, setShowBulkConfirm] = useState(false)

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

  async function handleBulkDelete() {
    setBulkDeleting(true)
    setShowBulkConfirm(false)
    setError(null)
    for (const courseId of selected) {
      await fetch(`/api/school/courses/${courseId}`, { method: 'DELETE' })
    }
    setCourses(prev => prev.filter(c => !selected.has(c.id)))
    setSelected(new Set())
    setBulkDeleting(false)
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selected.size === courses.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(courses.map(c => c.id)))
    }
  }

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

      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg">
          <span className="text-sm text-red-700 font-medium">{selected.size} course{selected.size > 1 ? 's' : ''} selected</span>
          <button
            onClick={() => setShowBulkConfirm(true)}
            disabled={bulkDeleting}
            className="px-4 py-1.5 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 transition disabled:opacity-50"
          >
            {bulkDeleting ? 'Deleting...' : 'Delete selected'}
          </button>
          <button onClick={() => setSelected(new Set())} className="text-sm text-red-400 hover:text-red-600">
            Clear selection
          </button>
        </div>
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
          <div className="px-5 py-2.5 flex items-center gap-3 bg-gray-50">
            <input
              type="checkbox"
              checked={selected.size === courses.length && courses.length > 0}
              onChange={toggleSelectAll}
              className="w-4 h-4 rounded border-gray-300 cursor-pointer"
            />
            <span className="text-xs text-gray-500">
              {selected.size > 0 ? `${selected.size} selected` : 'Select all'}
            </span>
          </div>

          {courses.map(course => {
            const totalClasses = course._schedules.reduce((s, sc) => s + sc.class_count, 0)
            return (
              <div key={course.id} className={`px-5 py-4 flex items-start gap-4 ${selected.has(course.id) ? 'bg-red-50/40' : ''}`}>
                <input
                  type="checkbox"
                  checked={selected.has(course.id)}
                  onChange={() => toggleSelect(course.id)}
                  className="w-4 h-4 rounded border-gray-300 cursor-pointer shrink-0 mt-1"
                />
                <div className="w-3 h-3 rounded-full shrink-0 mt-1" style={{ backgroundColor: course.color }} />

                <div className="flex-1 min-w-0">
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

                  {course._schedules.length > 0 ? (
                    <div className="mt-2 space-y-1">
                      {course._schedules.map((sc, i) => (
                        <div key={i} className="flex items-center gap-2 flex-wrap">
                          <span className="inline-flex items-center gap-1.5 text-xs bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1">
                            <span className="font-medium text-gray-700">{WEEKDAY_LABELS[sc.weekday] ?? sc.weekday}</span>
                            <span className="text-gray-300">·</span>
                            <span className="text-gray-500">{sc.start_time}</span>
                            <span className="text-gray-300">·</span>
                            <span className="text-gray-500">{sc.duration_minutes}min</span>
                            {sc.location_name && (
                              <>
                                <span className="text-gray-300">·</span>
                                <span className="text-gray-500">{sc.location_name}</span>
                              </>
                            )}
                            {sc.teacher_name && (
                              <>
                                <span className="text-gray-300">·</span>
                                <span className="text-gray-500">{sc.teacher_name}</span>
                              </>
                            )}
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

      {showBulkConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <h3 className="font-semibold text-gray-900 text-base">
              Delete {selected.size} course{selected.size > 1 ? 's' : ''}?
            </h3>
            <p className="text-sm text-gray-500">
              All future classes will be cancelled and booked students refunded. Past classes are kept. This cannot be undone.
            </p>
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleBulkDelete}
                className="flex-1 px-4 py-2.5 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 transition"
              >
                Yes, delete all
              </button>
              <button
                onClick={() => setShowBulkConfirm(false)}
                className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition"
              >
                Go back
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
