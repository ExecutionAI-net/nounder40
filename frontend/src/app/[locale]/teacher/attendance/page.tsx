'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { apiFetch } from '@/lib/api/client'
import { formatLessonDate, formatLessonTime, placeLabel } from '@/lib/lesson-format'
import { scopeParam, useTeacherScope } from '@/lib/teacher-scope'
import ScopeToggle from '@/components/teacher/ScopeToggle'

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
  teacher: string | null
  teacher_name: string
  lesson_type_name: string
  room_name: string
  location_name: string
}

export default function TeacherAttendancePage() {
  const t = useTranslations('teacher.attendance')
  const uiLocale = useLocale()
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [loading, setLoading] = useState(true)
  const [teacherId, setTeacherId] = useState<string | null>(null)
  const { scope, setScope, canViewAll, loaded: scopeLoaded } = useTeacherScope()

  useEffect(() => {
    apiFetch<{ id: string }>('/teacher/profile/').then(p => setTeacherId(p.id)).catch(() => {})
  }, [])

  const today = new Date().toISOString().split('T')[0]

  useEffect(() => {
    if (!scopeLoaded) return
    setLoading(true)
    // Finestra limitata: la sezione "Passate" serve a segnare in ritardo le
    // ultime lezioni, non a sfogliare l'archivio, e con "tutte le lezioni"
    // della scuola l'elenco intero sarebbe enorme
    const from = new Date(Date.now() - 60 * 86400000).toISOString().split('T')[0]
    apiFetch<Lesson[]>(`/teacher/lessons/?from=${from}${scopeParam(scope)}`)
      .then(data => {
        setLessons(data ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [scope, scopeLoaded, today])

  const todayLessons = lessons.filter(l => l.date === today)
  const upcomingLessons = lessons.filter(l => l.date > today)
  const pastLessons = lessons
    .filter(l => l.date < today)
    .sort((a, b) => b.date.localeCompare(a.date))

  function LessonCard({ lesson }: { lesson: Lesson }) {
    const isCompleted = lesson.status === 'completed'
    // QA TCH-R2-07: the register offered an actionable "Mark" button for a
    // lesson that hasn't happened yet; clicking it always failed server-side
    // (backend/bookings/attendance_views.py rejects with
    // "lesson_not_yet_occurred"). Gate it client-side too instead of letting
    // the teacher hit that error.
    const notYetOccurred = new Date(`${lesson.date}T${lesson.start_time}`) > new Date()
    const time = formatLessonTime(lesson.start_time, lesson.end_time)
    const place = placeLabel(lesson, t('online'))
    // Lezione di una collega (visibile perché la scuola l'ha resa staff)
    const colleague = teacherId && lesson.teacher && lesson.teacher !== teacherId ? lesson.teacher_name : null

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
              {colleague ? ` · 👤 ${colleague}` : ''}
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
          ) : notYetOccurred ? (
            <span className="text-xs bg-gray-50 text-gray-400 border border-gray-200 px-3 py-1.5 rounded-lg">
              {t('notYetOccurred')}
            </span>
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

  if (loading && lessons.length === 0) {
    return <div className="animate-pulse h-8 bg-gray-100 rounded w-48" />
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        {canViewAll && <ScopeToggle scope={scope} onChange={setScope} />}
      </div>

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

      <div className="mb-8">
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

      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{t('sectionPast')}</h2>
        {pastLessons.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-6 text-sm text-gray-400">
            {t('noLessons')}
          </div>
        ) : (
          <div className="space-y-3">
            {pastLessons.map(l => <LessonCard key={l.id} lesson={l} />)}
          </div>
        )}
      </div>
    </div>
  )
}
