'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

interface BookingRow {
  id: string
  student_id: string
  access_source: string
  attendance_status: string | null
  students: { name: string; email: string } | null
}

interface LessonDetail {
  id: string
  date: string
  start_time: string
  status: string
  courses: { name: string } | null
  school_rooms: { name: string } | null
}

export default function AttendanceLessonPage() {
  const { lessonId } = useParams<{ lessonId: string }>()
  const router = useRouter()

  const [lesson, setLesson] = useState<LessonDetail | null>(null)
  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [alreadySubmitted, setAlreadySubmitted] = useState(false)
  const [marks, setMarks] = useState<Record<string, 'present' | 'no_show'>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/attendance/${lessonId}`)
      .then(r => r.json())
      .then(data => {
        setLesson(data.lesson)
        setBookings(data.bookings ?? [])
        setAlreadySubmitted(data.already_submitted ?? false)

        // Pre-fill existing marks
        const initialMarks: Record<string, 'present' | 'no_show'> = {}
        for (const b of data.bookings ?? []) {
          if (b.attendance_status) {
            initialMarks[b.id] = b.attendance_status as 'present' | 'no_show'
          } else {
            initialMarks[b.id] = 'present' // default to present
          }
        }
        setMarks(initialMarks)
        setLoading(false)
      })
  }, [lessonId])

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)

    const attendance = bookings.map(b => ({
      booking_id: b.id,
      student_id: b.student_id,
      status: marks[b.id] ?? 'present',
    }))

    const res = await fetch(`/api/attendance/${lessonId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attendance }),
    })

    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? 'Failed to submit')
      setSubmitting(false)
      return
    }

    router.push('/teacher/attendance')
  }

  if (loading) {
    return <div className="animate-pulse h-8 bg-gray-100 rounded w-48" />
  }

  if (!lesson) {
    return <p className="text-gray-400 text-sm">Lesson not found.</p>
  }

  const course = lesson.courses
  const room = lesson.school_rooms

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Mark Attendance</h1>
        <p className="text-gray-500 text-sm mt-1">
          {course?.name} · {new Date(lesson.date).toLocaleDateString('en', { weekday: 'long', month: 'short', day: 'numeric' })} · {lesson.start_time?.slice(0, 5)}
          {room ? ` · ${room.name}` : ''}
        </p>
      </div>

      {alreadySubmitted && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-700">
          Attendance already submitted for this lesson.
        </div>
      )}

      {bookings.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-6 text-sm text-gray-400">
          No students booked for this lesson.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50 mb-6">
          {bookings.map(b => {
            const student = b.students
            const mark = marks[b.id] ?? 'present'
            return (
              <div key={b.id} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{student?.name ?? '—'}</p>
                  <p className="text-xs text-gray-400">{b.access_source}</p>
                </div>
                {alreadySubmitted ? (
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                    b.attendance_status === 'present'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-red-100 text-red-600'
                  }`}>
                    {b.attendance_status === 'present' ? 'Present' : 'No-show'}
                  </span>
                ) : (
                  <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
                    <button
                      onClick={() => setMarks(prev => ({ ...prev, [b.id]: 'present' }))}
                      className={`px-3 py-1.5 transition ${
                        mark === 'present'
                          ? 'bg-green-600 text-white'
                          : 'text-gray-500 hover:bg-gray-50'
                      }`}
                    >
                      Present
                    </button>
                    <button
                      onClick={() => setMarks(prev => ({ ...prev, [b.id]: 'no_show' }))}
                      className={`px-3 py-1.5 border-l border-gray-200 transition ${
                        mark === 'no_show'
                          ? 'bg-red-500 text-white'
                          : 'text-gray-500 hover:bg-gray-50'
                      }`}
                    >
                      No-show
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      {!alreadySubmitted && bookings.length > 0 && (
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full bg-gray-800 text-white rounded-xl py-3 text-sm font-medium hover:bg-gray-700 transition disabled:opacity-50"
        >
          {submitting ? 'Submitting...' : 'Submit Attendance'}
        </button>
      )}
    </div>
  )
}
