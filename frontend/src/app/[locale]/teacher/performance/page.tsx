'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { apiFetch } from '@/lib/api/client'

interface Stats {
  lessons_taught: number
  lessons_upcoming: number
  attendance_marked: number
  present: number
  no_show: number
  attendance_rate: number | null
}

export default function TeacherPerformancePage() {
  const t = useTranslations('teacher.performance')
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch<Stats>('/teacher/stats/')
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-sm text-gray-400">{t('title')}</div>
  if (!stats) return <p className="text-gray-400 text-sm">Teacher profile not found.</p>

  const total = stats.attendance_marked
  const present = stats.present
  const noShow = stats.no_show
  const rate = stats.attendance_rate != null ? Math.round(stats.attendance_rate * 100) : 0

  const kpis = [
    { label: t('lessonsTeaught'), value: stats.lessons_taught },
    { label: t('studentsFollowed'), value: present },
    { label: t('noShowRate'), value: noShow },
    { label: t('attendanceRate'), value: `${rate}%` },
  ]

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">{t('title')}</h1>

      <div className="grid grid-cols-2 gap-4 mb-8">
        {kpis.map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-gray-100 p-5">
            <p className="text-xs text-gray-400 uppercase tracking-wide">{k.label}</p>
            <p className="text-3xl font-bold text-gray-900 mt-2">{k.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">{t('noData')}</h2>
        {total === 0 ? (
          <p className="text-sm text-gray-400">{t('noData')}</p>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Present</span>
                <span>{present} / {total}</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full"
                  style={{ width: `${rate}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>No-show</span>
                <span>{noShow} / {total}</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-red-400 rounded-full"
                  style={{ width: `${total > 0 ? Math.round((noShow / total) * 100) : 0}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
