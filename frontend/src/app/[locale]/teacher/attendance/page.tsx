'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { apiFetch } from '@/lib/api/client'
import { formatLessonDate, formatLessonTime, placeLabel } from '@/lib/lesson-format'
import { schoolParam, scopeParam, useTeacherSchool, useTeacherScope } from '@/lib/teacher-scope'
import ScopeToggle from '@/components/teacher/ScopeToggle'
import { attendanceWindow, localISODate, type WindowKind } from '@/lib/attendance-window'

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
  const [todayLessons, setTodayLessons] = useState<Lesson[]>([])
  const [upcomingLessons, setUpcomingLessons] = useState<Lesson[]>([])
  const [pastLessons, setPastLessons] = useState<Lesson[]>([])
  const [upcomingPage, setUpcomingPage] = useState(0)
  const [pastPage, setPastPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [windowLoading, setWindowLoading] = useState<Record<WindowKind, boolean>>({ upcoming: false, past: false })
  const [teacherId, setTeacherId] = useState<string | null>(null)
  const { scope, setScope, canViewAll, loaded: scopeLoaded } = useTeacherScope()
  const schoolId = useTeacherSchool()

  useEffect(() => {
    apiFetch<{ id: string }>('/teacher/profile/').then(p => setTeacherId(p.id)).catch(() => {})
  }, [])

  const today = localISODate(new Date())
  const filters = `${scopeParam(scope)}${schoolParam(schoolId)}`

  // Another scope / school is another list: back to the nearest window
  useEffect(() => {
    setUpcomingPage(0)
    setPastPage(0)
  }, [scope, schoolId])

  useEffect(() => {
    if (!scopeLoaded) return
    let cancelled = false
    setLoading(true)
    apiFetch<Lesson[]>(`/teacher/lessons/?date=${today}${filters}`)
      .then(data => { if (!cancelled) setTodayLessons(data ?? []) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [scopeLoaded, today, filters])

  // Upcoming and Past each load one two-week window (lib/attendance-window.ts)
  // instead of every lesson from here to infinity
  function useWindow(kind: WindowKind, page: number, set: (rows: Lesson[]) => void) {
    useEffect(() => {
      if (!scopeLoaded) return
      let cancelled = false
      const { from, to } = attendanceWindow(kind, page)
      setWindowLoading(w => ({ ...w, [kind]: true }))
      apiFetch<Lesson[]>(`/teacher/lessons/?from=${from}&to=${to}${filters}`)
        .then(data => { if (!cancelled) set(data ?? []) })
        .catch(() => { if (!cancelled) set([]) })
        .finally(() => { if (!cancelled) setWindowLoading(w => ({ ...w, [kind]: false })) })
      return () => { cancelled = true }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scopeLoaded, page, filters, today])
  }
  useWindow('upcoming', upcomingPage, setUpcomingLessons)
  useWindow('past', pastPage, rows => setPastLessons([...rows].sort((a, b) => b.date.localeCompare(a.date))))

  function WindowPager({ kind, page, setPage }: { kind: WindowKind; page: number; setPage: (p: number) => void }) {
    const { from, to } = attendanceWindow(kind, page)
    // Earlier / later on the calendar: for Past, "earlier" is the higher page
    const earlierPage = kind === 'past' ? page + 1 : page - 1
    const laterPage = kind === 'past' ? page - 1 : page + 1
    const canEarlier = earlierPage >= 0
    const canLater = laterPage >= 0
    const btn = 'text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition disabled:opacity-40 disabled:hover:bg-transparent'
    return (
      <div className="mb-3 flex items-center justify-between gap-2">
        <button className={btn} disabled={!canEarlier} onClick={() => setPage(earlierPage)}>← {t('periodEarlier')}</button>
        <span className="text-xs text-gray-500 text-center">
          {t('periodRange', { from: formatLessonDate(from, uiLocale), to: formatLessonDate(to, uiLocale) })}
        </span>
        <button className={btn} disabled={!canLater} onClick={() => setPage(laterPage)}>{t('periodLater')} →</button>
      </div>
    )
  }

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
            <p className="text-xs text-gray-500">
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
          ) : lesson.status === 'cancelled' ? null : (
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

  if (loading && todayLessons.length === 0) {
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
        <WindowPager kind="upcoming" page={upcomingPage} setPage={setUpcomingPage} />
        {windowLoading.upcoming ? (
          <div className="animate-pulse h-16 bg-gray-100 rounded-xl" />
        ) : upcomingLessons.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-6 text-sm text-gray-400">
            {t('noLessonsInPeriod')}
          </div>
        ) : (
          <div className="space-y-3">
            {upcomingLessons.map(l => <LessonCard key={l.id} lesson={l} />)}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{t('sectionPast')}</h2>
        <WindowPager kind="past" page={pastPage} setPage={setPastPage} />
        {windowLoading.past ? (
          <div className="animate-pulse h-16 bg-gray-100 rounded-xl" />
        ) : pastLessons.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-6 text-sm text-gray-400">
            {t('noLessonsInPeriod')}
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
