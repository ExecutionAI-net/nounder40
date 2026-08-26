'use client'

import { useEffect, useState } from 'react'
import { Link } from '@/navigation'
import { useTranslations } from 'next-intl'
import { useAuth } from '@/lib/api/auth-context'
import { apiFetch } from '@/lib/api/client'

interface CreditRow { school_id: string; school_name: string; credits: number }
interface BookingRow { id: string; status: string }

export default function StudentDashboard() {
  const t = useTranslations('student.dashboard')
  const { user, loading: authLoading } = useAuth()
  const [totalCredits, setTotalCredits] = useState(0)
  const [upcomingCount, setUpcomingCount] = useState(0)
  // Il saluto usa il nome del profilo studentessa, non quello dell'account
  const [profile, setProfile] = useState<{ name?: string; first_name?: string } | null>(null)

  useEffect(() => {
    if (!user) return
    apiFetch<CreditRow[]>('/student/credits/')
      .then((rows) => setTotalCredits(rows.reduce((sum, r) => sum + (r.credits || 0), 0)))
      .catch(() => {})
    apiFetch<BookingRow[]>('/student/bookings/?status=upcoming')
      .then((rows) => setUpcomingCount(rows.length))
      .catch(() => {})
    apiFetch<{ name?: string; first_name?: string }>('/student/profile/').then(setProfile).catch(() => {})
  }, [user])

  if (authLoading || !user) return null

  const firstName = profile?.first_name || profile?.name?.split(' ')[0] || user.full_name?.split(' ')[0] || ''

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          {t('greeting', { name: firstName })}
        </h1>
        <p className="text-gray-500 mt-1">{t('subtitle')}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        {[
          { label: t('credits'), value: totalCredits },
          { label: t('upcomingLessons'), value: upcomingCount },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-white rounded-xl border border-gray-100 p-5">
            <p className="text-xs text-gray-400 uppercase tracking-wide">{kpi.label}</p>
            <p className="text-3xl font-bold text-brand mt-2">{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link href="/student/book" className="bg-brand text-white rounded-xl p-5 hover:bg-brand-hover transition">
          <p className="font-semibold">{t('bookAClass')}</p>
          <p className="text-xs opacity-70 mt-0.5">{t('bookAClassDesc')}</p>
        </Link>
        <Link href="/student/bookings" className="bg-white border border-gray-100 rounded-xl p-5 hover:bg-gray-50 transition">
          <p className="font-semibold text-gray-900">{t('myLessons')}</p>
          <p className="text-xs text-gray-400 mt-0.5">{t('myLessonsDesc')}</p>
        </Link>
        <Link href="/student/packages" className="bg-white border border-gray-100 rounded-xl p-5 hover:bg-gray-50 transition">
          <p className="font-semibold text-gray-900">{t('myAccess')}</p>
          <p className="text-xs text-gray-400 mt-0.5">{t('myAccessDesc', { count: totalCredits })}</p>
        </Link>
        <Link href="/student/profile" className="bg-white border border-gray-100 rounded-xl p-5 hover:bg-gray-50 transition">
          <p className="font-semibold text-gray-900">{t('profile')}</p>
          <p className="text-xs text-gray-400 mt-0.5">{t('profileDesc')}</p>
        </Link>
      </div>
    </div>
  )
}
