'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/navigation'
import { useAuth } from '@/lib/api/auth-context'
import { apiFetch } from '@/lib/api/client'

interface HQReport {
  active_schools: number
  total_students: number
  lessons_this_week: number
  active_subscriptions: number
}

interface SchoolRow {
  id: string
  name: string
  city: string
  country: string
  active: boolean
  created_at: string
}

export default function HQDashboard() {
  const t = useTranslations('hq.dashboard')
  const { user, loading: authLoading } = useAuth()
  const [report, setReport] = useState<HQReport | null>(null)
  const [recentSchools, setRecentSchools] = useState<SchoolRow[]>([])

  useEffect(() => {
    if (!user) return
    apiFetch<HQReport>('/hq/reports/').then(setReport).catch(() => {})
    apiFetch<SchoolRow[]>('/hq/schools/')
      .then((rows) => {
        const sorted = [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        setRecentSchools(sorted.slice(0, 5))
      })
      .catch(() => {})
  }, [user])

  if (authLoading || !user) return null

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
          <p className="text-gray-500 mt-1">
            {t('welcome', { name: user.full_name || user.email })}
            {user.hq_sub_role && (
              <span className="ml-2 text-xs bg-[#6B1F3A]/10 text-[#6B1F3A] px-2 py-0.5 rounded-full uppercase tracking-wide">
                {user.hq_sub_role.replace('_', ' ')}
              </span>
            )}
          </p>
        </div>
        <Link
          href="/hq/schools/new"
          className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition"
        >
          {t('newSchool')}
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: t('kpiActiveSchools'), value: report?.active_schools ?? 0 },
          { label: t('kpiTotalStudents'), value: report?.total_students ?? 0 },
          { label: t('kpiWeeklyLessons'), value: report?.lessons_this_week ?? 0 },
          { label: t('kpiActiveSubscriptions'), value: report?.active_subscriptions ?? 0 },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-white rounded-xl border border-gray-100 p-5">
            <p className="text-xs text-gray-400 uppercase tracking-wide">{kpi.label}</p>
            <p className="text-3xl font-bold text-gray-900 mt-2">{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-100">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">{t('recentSchools')}</h2>
          <Link href="/hq/schools" className="text-sm text-[#6B1F3A] hover:underline">{t('viewAll')}</Link>
        </div>
        {!recentSchools.length ? (
          <div className="px-6 py-8 text-center text-sm text-gray-400">
            {t('noSchools')} {' '}
            <Link href="/hq/schools/new" className="text-[#6B1F3A] hover:underline">
              {t('createFirst')}
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {recentSchools.map((school) => (
              <Link
                key={school.id}
                href={`/hq/schools/${school.id}`}
                className="flex items-center px-6 py-3 hover:bg-gray-50 transition"
              >
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">{school.name}</p>
                  <p className="text-xs text-gray-400">{school.city}, {school.country}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${school.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {school.active ? t('statusActive') : t('statusInactive')}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
