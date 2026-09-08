'use client'

import { useEffect, useState } from 'react'
import { Link } from '@/navigation'
import { useTranslations } from 'next-intl'
import { useAuth } from '@/lib/api/auth-context'
import { apiFetch } from '@/lib/api/client'

// QA ST-R2-17: an anonymous visit here rendered nothing at all -- other
// account-tied student pages (packages/buy/shop/bookings) all show the same
// "sign in to continue" prompt instead. In practice StudentLayout's own nav
// points an anonymous "home" at the public "/", not here, so this only ever
// fires for a stale bookmark or a direct URL -- but a blank page is still a
// worse landing than the shared prompt.
function LoginPrompt({ t, tLayout }: { t: (k: string) => string; tLayout: (k: string) => string }) {
  return (
    <div className="max-w-md mx-auto mt-10 bg-white rounded-2xl border border-gray-100 p-8 text-center">
      <div className="w-12 h-12 mx-auto rounded-full bg-brand/10 text-brand flex items-center justify-center mb-3">
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
        </svg>
      </div>
      <h2 className="font-semibold text-gray-900 text-lg">{t('loginPromptTitle')}</h2>
      <p className="text-sm text-gray-500 mt-1.5 mb-6">{t('loginPromptText')}</p>
      <div className="space-y-2">
        <Link href="/register?next=%2Fstudent%2Fdashboard"
          className="block w-full py-2.5 bg-brand text-white rounded-xl text-sm font-medium hover:bg-brand-hover transition">
          {tLayout('register')}
        </Link>
        <Link href="/login?next=%2Fstudent%2Fdashboard"
          className="block w-full py-2.5 border border-brand/30 text-brand rounded-xl text-sm font-medium hover:bg-brand/5 transition">
          {tLayout('signIn')}
        </Link>
      </div>
    </div>
  )
}

interface CreditRow { school_id: string; school_name: string; credits: number; lessons: number | null; credits_without_lessons: number }
interface BookingRow { id: string; status: string }

export default function StudentDashboard() {
  const t = useTranslations('student.dashboard')
  const tLayout = useTranslations('layout')
  const { user, loading: authLoading } = useAuth()
  const [totalCredits, setTotalCredits] = useState(0)
  const [totalLessons, setTotalLessons] = useState<number | null>(null)
  const [upcomingCount, setUpcomingCount] = useState(0)
  // Il saluto usa il nome del profilo studentessa, non quello dell'account
  const [profile, setProfile] = useState<{ name?: string; first_name?: string } | null>(null)

  useEffect(() => {
    if (!user) return
    apiFetch<CreditRow[]>('/student/credits/')
      .then((rows) => {
        setTotalCredits(rows.reduce((sum, r) => sum + Number(r.credits || 0), 0))
        // Lezioni sommate pacchetto per pacchetto dal backend; null quando
        // nessun pacchetto e' traducibile (illimitati, o tipi a costi diversi)
        const convertibili = rows.filter(r => r.lessons != null)
        setTotalLessons(convertibili.length
          ? convertibili.reduce((sum, r) => sum + (r.lessons ?? 0), 0)
          : null)
      })
      .catch(() => {})
    apiFetch<BookingRow[]>('/student/bookings/?status=upcoming')
      .then((rows) => setUpcomingCount(rows.length))
      .catch(() => {})
    apiFetch<{ name?: string; first_name?: string }>('/student/profile/').then(setProfile).catch(() => {})
  }, [user])

  if (authLoading) return null
  if (!user) return <LoginPrompt t={t} tLayout={tLayout} />

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
          totalLessons !== null
            ? { label: t('lessons'), value: totalLessons }
            : { label: t('credits'), value: totalCredits },
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
