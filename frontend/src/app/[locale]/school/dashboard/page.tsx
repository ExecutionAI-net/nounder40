'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useAuth } from '@/lib/api/auth-context'
import { apiFetch } from '@/lib/api/client'

function KpiCard({ label, value, tooltip }: { label: string; value: string | number; tooltip: string }) {
  return (
    <div className="relative group bg-white rounded-xl border border-gray-100 p-5">
      <p className="text-xs text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="text-3xl font-bold text-gray-900 mt-2">{value}</p>
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10 w-56">
        <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 text-center shadow-lg">
          {tooltip}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
        </div>
      </div>
    </div>
  )
}

interface SchoolReport {
  active_students: number
  weekly_lessons: number
  monthly_revenue_net: number
  active_subscriptions_count: number
}

export default function SchoolDashboard() {
  const t = useTranslations('school.dashboard')
  const { user, loading: authLoading } = useAuth()
  const [report, setReport] = useState<SchoolReport | null>(null)

  useEffect(() => {
    if (!user) return
    apiFetch<SchoolReport>('/school/reports/').then(setReport).catch(() => {})
  }, [user])

  if (authLoading || !user) return null

  const activeStudents = report?.active_students ?? 0
  const weeklyLessons = report?.weekly_lessons ?? 0
  const monthlyRevenue = report?.monthly_revenue_net ?? 0
  const activeSubscriptions = report?.active_subscriptions_count ?? 0

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-gray-500 mt-1">
          {t('welcomeBack')} {user.full_name || user.email}
          {user.school_sub_role && (
            <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full uppercase tracking-wide">
              {user.school_sub_role}
            </span>
          )}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label={t('activeStudents')}
          value={activeStudents}
          tooltip={t('activeStudentsTooltip')}
        />
        <KpiCard
          label={t('weeklyLessons')}
          value={weeklyLessons}
          tooltip={t('weeklyLessonsTooltip')}
        />
        <KpiCard
          label={t('monthlyRevenue')}
          value={`€${monthlyRevenue.toFixed(2)}`}
          tooltip={t('monthlyRevenueTooltip')}
        />
        <KpiCard
          label={t('activeSubscriptions')}
          value={activeSubscriptions}
          tooltip={t('activeSubscriptionsTooltip')}
        />
      </div>
    </div>
  )
}
