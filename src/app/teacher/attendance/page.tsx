'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Lesson {
  id: string
  date: string
  start_time: string
  end_time: string
  status: string
  current_bookings: number
  max_capacity: number
  courses: { name: string; color: string } | null
  lesson_types: { name_en: string } | null
  school_rooms: { name: string; school_locations: { name: string } | null } | null
  schools: { name: string; city: string } | null
}

export default function TeacherAttendancePage() {
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/teacher/lessons')
      .then(r => r.json())
      .then(data => {
        setLessons(data.lessons ?? [])
        setLoading(false)
      })
  }, [])

  const today = new Date().toISOString().split('T')[0]
  const todayLessons = lessons.filter(l => l.date === today)
  const upcomingLessons = lessons.filter(l => l.date > today)

  function LessonCard({ lesson }: { lesson: Lesson }) {
    const course = lesson.courses
    const room = lesson.school_rooms
    const school = lesson.schools
    const isCompleted = lesson.status === 'completed'

    return (
      <div className="bg-white rounded-xl border border-gray-100 p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-3 h-3 rounded-full shrink-0"
            style={{ backgroundColor: course?.color ?? '#6B1F3A' }}
          />
          <div>
            <p className="font-medium text-gray-900 text-sm">{course?.name ?? 'Lesson'}</p>
            <p className="text-xs text-gray-400">
              {lesson.start_time?.slice(0, 5)}
              {room ? ` · ${room.name}` : ''}
              {school ? ` · ${school.name}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">{lesson.current_bookings} students</span>
          {isCompleted ? (
            <span className="text-xs bg-green-100 text-green-700 px-3 py-1.5 rounded-lg">Done</span>
          ) : (
            <Link
              href={`/teacher/attendance/${lesson.id}`}
              className="text-xs bg-gray-800 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700 transition"
            >
              Mark
            </Link>
          )}
        </div>
      </div>
    )
  }

  if (loading) {
    return <div className="animate-pulse h-8 bg-gray-100 rounded w-48" />
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Attendance</h1>

      <div className="mb-8">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Today</h2>
        {todayLessons.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-6 text-sm text-gray-400">
            No lessons today.
          </div>
        ) : (
          <div className="space-y-3">
            {todayLessons.map(l => <LessonCard key={l.id} lesson={l} />)}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Upcoming</h2>
        {upcomingLessons.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-6 text-sm text-gray-400">
            No upcoming lessons.
          </div>
        ) : (
          <div className="space-y-3">
            {upcomingLessons.map(l => <LessonCard key={l.id} lesson={l} />)}
          </div>
        )}
      </div>
    </div>
  )
}
