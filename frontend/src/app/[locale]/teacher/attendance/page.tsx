'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { apiFetch } from '@/lib/api/client'
import { formatLessonDate, formatLessonTime, placeLabel } from '@/lib/lesson-format'

interface Lesson {
  id: string
  date: string
  start_time: string
  end_time: string
  status: string
  current_bookings: number
  max_capacity: number
  color: string | null
  is_online: boolean
  school_name: string
  lesson_type_name: string
  room_name: string
  location_name: string
}

export default function TeacherAttendancePage() {
  const t = useTranslations('teacher.attendance')
  const uiLocale = useLocale()
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch<Lesson[]>('/teacher/lessons/')
      .then(data => {
        setLessons(data ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const today = new Date().toISOString().split('T')[0]
  const todayLessons = lessons.filter(l => l.date === today)
  const upcomingLessons = lessons.filter(l => l.date > today)

  function LessonCard({ lesson }: { lesson: Lesson }) {
    const isCompleted = lesson.status === 'completed'
    const time = formatLessonTime(lesson.start_time, lesson.end_time)
    const place = placeLabel(lesson, t('online'))

    return (
      <div className="bg-white rounded-xl border border-gray-100 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className="w-3 h-3 rounded-full shrink-0 mt-1"
            style={{ backgroundColor: lesson.color || '#6B1F3A' }}
          />
          <div className="min-w-0">
            <p className="font-medium text-gray-900 text-sm truncate">{lesson.lesson_type_name || '—'}</p>
            <p className="text-xs text-gray-500 capitalize">
              {formatLessonDate(lesson.date, uiLocale)}{time ? ` · ${time}` : ''}
            </p>
            <p className="text-xs text-gray-400 truncate">
              {place}
              {lesson.school_name ? `${place ? ' · ' : ''}${lesson.school_name}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {lesson.status === 'cancelled' && (
            <span className="text-xs font-medium bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full line-through">{t('cancelledBadge')}</span>
          )}
          <span className="text-xs text-gray-400">
            {t('studentsCount', { count: lesson.current_bookings })}
          </span>
          {isCompleted ? (
            <span className="text-xs bg-green-100 text-green-700 px-3 py-1.5 rounded-lg">{t('badgeDone')}</span>
          ) : (
            <Link
              href={`/teacher/attendance/${lesson.id}`}
              className="text-xs bg-gray-800 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700 transition"
            >
              {t('buttonMark')}
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
      <h1 className="text-2xl font-bold text-gray-900 mb-6">{t('title')}</h1>

      <div className="mb-8">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{t('sectionToday')}</h2>
        {todayLessons.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-6 text-sm text-gray-400">
            {t('noLessons')}
          </div>
        ) : (
          <div className="space-y-3">
            {todayLessons.map(l => <LessonCard key={l.id} lesson={l} />)}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{t('sectionUpcoming')}</h2>
        {upcomingLessons.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-6 text-sm text-gray-400">
            {t('noLessons')}
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
