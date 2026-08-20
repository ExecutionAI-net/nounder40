'use client'

import { useEffect, useState } from 'react'
import { Link } from '@/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { useAuth } from '@/lib/api/auth-context'
import { apiFetch } from '@/lib/api/client'

interface LessonRow {
  id: string
  date: string
  start_time: string
  school_name: string
  room_name: string
  lesson_type_name: string
  color: string
  current_bookings: number
  max_capacity: number
}

interface Assignment {
  school_id: string
  school_name: string
  compensation_plan: { name: string; base_fee: string; bonus_threshold: number | null; bonus_per_student: string } | null
}

export default function TeacherDashboard() {
  const t = useTranslations('teacher.dashboard')
  const uiLocale = useLocale()
  const { user, loading: authLoading } = useAuth()
  const [todayLessons, setTodayLessons] = useState<LessonRow[]>([])
  const [upcomingLessons, setUpcomingLessons] = useState<LessonRow[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])

  useEffect(() => {
    if (!user) return
    const today = new Date().toISOString().split('T')[0]
    const weekEnd = new Date()
    weekEnd.setDate(weekEnd.getDate() + 7)
    const weekEndStr = weekEnd.toISOString().split('T')[0]
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStr = tomorrow.toISOString().split('T')[0]

    apiFetch<LessonRow[]>(`/teacher/lessons/?date=${today}`).then(setTodayLessons).catch(() => {})
    apiFetch<LessonRow[]>(`/teacher/lessons/?from=${tomorrowStr}&to=${weekEndStr}`).then(setUpcomingLessons).catch(() => {})
    apiFetch<Assignment[]>('/teacher/schools/').then(setAssignments).catch(() => {})
  }, [user])

  if (authLoading || !user) return null

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          {t('greeting', { name: user.full_name?.split(' ')[0] || 'Teacher' })}
        </h1>
        <p className="text-gray-500 mt-1">{t('subtitleSchedule')}</p>
      </div>

      {/* Today */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{t('sectionToday')}</h2>
        {todayLessons.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-6 text-sm text-gray-400">
            {t('noLessonToday')}
          </div>
        ) : (
          <div className="space-y-3">
            {todayLessons.map(lesson => (
              <div key={lesson.id} className="bg-white rounded-xl border border-gray-100 p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: lesson.color || '#6B1F3A' }}
                  />
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{lesson.lesson_type_name || 'Lesson'}</p>
                    <p className="text-xs text-gray-400">
                      {lesson.start_time?.slice(0, 5)} — {lesson.room_name || ''} · {lesson.school_name || ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400">{lesson.current_bookings}/{lesson.max_capacity}</span>
                  <Link
                    href={`/teacher/attendance/${lesson.id}`}
                    className="text-xs bg-gray-800 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700 transition"
                  >
                    {t('buttonAttendance')}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Upcoming */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{t('sectionUpcoming')}</h2>
        {upcomingLessons.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-6 text-sm text-gray-400">
            {t('noUpcomingLessons')}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
            {upcomingLessons.map(lesson => (
              <div key={lesson.id} className="px-4 py-3 flex items-center gap-3">
                <div
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: lesson.color || '#6B1F3A' }}
                />
                <span className="text-sm text-gray-900">{lesson.lesson_type_name}</span>
                <span className="text-xs text-gray-400 ml-auto">
                  {new Date(lesson.date).toLocaleDateString(uiLocale, { weekday: 'short', month: 'short', day: 'numeric' })} · {lesson.start_time?.slice(0, 5)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Compensation Plans */}
      {assignments.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{t('sectionCompensationPlans')}</h2>
          <div className="space-y-2">
            {assignments.map((a) => {
              const plan = a.compensation_plan
              const tooltipText = plan
                ? t('tooltipBaseFee', { baseFee: plan.base_fee, bonusPerStudent: plan.bonus_per_student, bonusThreshold: plan.bonus_threshold ?? 0 })
                : t('noCompensationMessage')
              return (
                <div key={a.school_id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center justify-between">
                  <p className="text-sm text-gray-700 font-medium">{a.school_name}</p>
                  <div className="group relative">
                    {plan ? (
                      <span className="text-xs font-medium text-gray-700 bg-gray-100 px-2.5 py-1 rounded-full cursor-default">
                        {plan.name}
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full cursor-default">
                        {t('noCompensationPlan')}
                      </span>
                    )}
                    <div className="absolute bottom-full right-0 mb-1.5 hidden group-hover:block z-10 w-64">
                      <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 leading-relaxed shadow-lg">
                        {tooltipText}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
