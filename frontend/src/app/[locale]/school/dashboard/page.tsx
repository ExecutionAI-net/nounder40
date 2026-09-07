'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useAuth } from '@/lib/api/auth-context'
import { ApiError, apiFetch } from '@/lib/api/client'

function KpiCard({ label, value, tooltip, muted }: { label: string; value: string | number; tooltip: string; muted?: boolean }) {
  return (
    <div className="relative group bg-white rounded-xl border border-gray-100 p-5">
      <p className="text-xs text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`text-3xl font-bold mt-2 ${muted ? 'text-gray-300' : 'text-gray-900'}`}>{value}</p>
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
  // Un membro `staff` non ha il permesso sui report: il 403 mostrava
  // "0 allieve / €0", un dato inventato. Si distingue "non disponibile"
  // da "davvero zero" (QA round 2, R2-M2).
  const [reportError, setReportError] = useState<'forbidden' | 'failed' | null>(null)

  useEffect(() => {
    if (!user) return
    apiFetch<SchoolReport>('/school/reports/')
      .then((data) => { setReport(data); setReportError(null) })
      .catch((err) => {
        setReport(null)
        setReportError(err instanceof ApiError && (err.status === 403 || err.status === 401) ? 'forbidden' : 'failed')
      })
  }, [user])

  if (authLoading || !user) return null

  const dash = '—'
  const activeStudents = report ? report.active_students : dash
  const weeklyLessons = report ? report.weekly_lessons : dash
  const monthlyRevenue = report ? `€${report.monthly_revenue_net.toFixed(2)}` : dash
  const activeSubscriptions = report ? report.active_subscriptions_count : dash

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
          muted={!report}
        />
        <KpiCard
          label={t('weeklyLessons')}
          value={weeklyLessons}
          tooltip={t('weeklyLessonsTooltip')}
          muted={!report}
        />
        <KpiCard
          label={t('monthlyRevenue')}
          value={monthlyRevenue}
          tooltip={t('monthlyRevenueTooltip')}
          muted={!report}
        />
        <KpiCard
          label={t('activeSubscriptions')}
          value={activeSubscriptions}
          tooltip={t('activeSubscriptionsTooltip')}
          muted={!report}
        />
      </div>
      {reportError && (
        <p className="mt-2 text-xs text-gray-400">
          {reportError === 'forbidden' ? t('kpiUnavailable') : t('kpiLoadFailed')}
        </p>
      )}
    </div>
  )
}
