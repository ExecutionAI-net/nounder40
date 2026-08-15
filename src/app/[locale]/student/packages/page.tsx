'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Link } from '@/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { createClient } from '@/lib/supabase/client'

type StudentPackage = {
  id: string
  credits_total: number
  credits_remaining: number
  purchased_at: string
  expires_at: string
  status: string
  payment_method: string
  packages: { name_en: string; color: string; description_en: string | null } | null
  schools: { name: string; city: string } | null
}

type StudentSubscription = {
  id: string
  access_total: number | null
  access_remaining: number | null
  started_at: string
  current_period_end: string
  status: string
  subscriptions_catalog: { name_en: string; color: string; period_value: number; period_unit: string; is_vip: boolean } | null
  schools: { name: string; city: string } | null
}

type CreditTx = {
  id: string
  date: string
  lesson_date: string | null
  lesson_name: string
  school_name: string
  package_name: string | null
  student_package_id: string | null
  credits: number
  type: 'deducted' | 'refund' | 'no_show' | 'purchase'
  status: string
}

type PackageSummary = {
  id: string
  credits_remaining: number
  credits_total: number
  expires_at: string
  packages: { name_en: string; color: string } | null
  schools: { name: string } | null
}

function StudentPackagesContent() {
  const t = useTranslations('student.packages')
  const uiLocale = useLocale()
  const tLayout = useTranslations('layout')
  const searchParams = useSearchParams()
  // I pacchetti sono personali: gli anonimi vedono un invito ad accedere
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null)
  const [tab, setTab] = useState<'packages' | 'subscriptions' | 'history'>('packages')
  const [packages, setPackages] = useState<StudentPackage[]>([])
  const [subscriptions, setSubscriptions] = useState<StudentSubscription[]>([])
  const [history, setHistory] = useState<CreditTx[]>([])
  const [totalCredits, setTotalCredits] = useState(0)
  const [activePackages, setActivePackages] = useState<PackageSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [paymentSuccess, setPaymentSuccess] = useState(false)
  const [expandedPkg, setExpandedPkg] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const { data: { user } } = await createClient().auth.getUser()
    setIsAuthed(!!user)
    if (!user) { setLoading(false); return }
    const [pkgRes, subRes, credRes] = await Promise.all([
      fetch('/api/student/packages', { cache: 'no-store' }),
      fetch('/api/student/subscriptions', { cache: 'no-store' }),
      fetch('/api/student/credits', { cache: 'no-store' }),
    ])
    if (pkgRes.ok) setPackages(await pkgRes.json())
    if (subRes.ok) setSubscriptions(await subRes.json())
    if (credRes.ok) {
      const d = await credRes.json()
      setTotalCredits(d.totalCredits ?? 0)
      setActivePackages(d.packages ?? [])
      setHistory(d.history ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    const isSuccess = searchParams.get('payment') === 'success'
    const sessionId = searchParams.get('session_id')

    if (isSuccess && sessionId) {
      setPaymentSuccess(true)
      fetch('/api/stripe/verify-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      })
        .then(r => r.json())
        .then(d => {
          console.log('[packages] verify-session result:', d)
          load()
        })
        .catch(() => load())
    } else {
      load()
    }

    const onCreditsChanged = () => load()
    const onVisibility = () => { if (document.visibilityState === 'visible') load() }
    window.addEventListener('credits-changed', onCreditsChanged)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('credits-changed', onCreditsChanged)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString(uiLocale, { day: 'numeric', month: 'short', year: 'numeric' })
  }

  function formatShort(d: string) {
    return new Date(d).toLocaleDateString(uiLocale, { day: 'numeric', month: 'short' })
  }

  function progressPercent(remaining: number, total: number) {
    return total > 0 ? Math.round((remaining / total) * 100) : 0
  }

  const tabs = [
    { key: 'packages' as const, label: t('tabPackages') },
    { key: 'subscriptions' as const, label: t('tabSubscriptions') },
    { key: 'history' as const, label: t('tabHistory') },
  ]

  // Visitatore anonimo: pacchetti e crediti sono legati all'account
  if (isAuthed === false) {
    return (
      <div className="max-w-md mx-auto mt-10 bg-white rounded-2xl border border-gray-100 p-8 text-center">
        <div className="w-12 h-12 mx-auto rounded-full bg-[#6B1F3A]/10 text-[#6B1F3A] flex items-center justify-center mb-3">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
          </svg>
        </div>
        <h2 className="font-semibold text-gray-900 text-lg">{t('loginPromptTitle')}</h2>
        <p className="text-sm text-gray-500 mt-1.5 mb-6">{t('loginPromptText')}</p>
        <div className="space-y-2">
          <Link href="/register?next=%2Fstudent%2Fpackages"
            className="block w-full py-2.5 bg-[#6B1F3A] text-white rounded-xl text-sm font-medium hover:bg-[#5a1930] transition">
            {tLayout('register')}
          </Link>
          <Link href="/login?next=%2Fstudent%2Fpackages"
            className="block w-full py-2.5 border border-[#6B1F3A]/30 text-[#6B1F3A] rounded-xl text-sm font-medium hover:bg-[#6B1F3A]/5 transition">
            {tLayout('signIn')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-gray-500 text-sm mt-0.5">{t('subtitle')}</p>
      </div>

      {paymentSuccess && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700 flex justify-between items-center">
          {t('paymentSuccess')}
          <button onClick={() => setPaymentSuccess(false)} className="text-green-400 text-xs ml-4">✕</button>
        </div>
      )}

      {/* Credit summary card */}
      <div className="bg-[#6B1F3A] rounded-2xl p-5 mb-5 text-white">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-white/70 text-xs uppercase tracking-wide font-medium mb-1">{t('totalCreditsAvailable')}</p>
            <p className="text-5xl font-bold leading-none">{loading ? '—' : totalCredits}</p>
            <p className="text-white/60 text-xs mt-2">{t('acrossAllPackages')}</p>
          </div>
          <div className="bg-white/10 rounded-xl p-3">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-white">
              <path d="M2.25 2.25a.75.75 0 0 0 0 1.5h1.386c.17 0 .318.114.362.278l2.558 9.592a3.752 3.752 0 0 0-2.806 3.63c0 .414.336.75.75.75h15.75a.75.75 0 0 0 0-1.5H5.378A2.25 2.25 0 0 1 7.5 15h11.218a.75.75 0 0 0 .674-.421 60.358 60.358 0 0 0 2.96-7.228.75.75 0 0 0-.525-.965A60.864 60.864 0 0 0 5.68 4.509l-.232-.867A1.875 1.875 0 0 0 3.636 2.25H2.25Z" />
              <path d="M3.75 20.25a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0ZM16.5 20.25a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Z" />
            </svg>
          </div>
        </div>

        {!loading && activePackages.length > 0 && (
          <div className="mt-4 space-y-2">
            {activePackages.map((p) => {
              const pct = progressPercent(p.credits_remaining, p.credits_total)
              return (
                <div key={p.id}>
                  <div className="flex justify-between text-xs text-white/80 mb-1">
                    <span>{p.packages?.name_en ?? t('packageDefault')} · {p.schools?.name}</span>
                    <span>{p.credits_remaining} / {p.credits_total} · exp {formatShort(p.expires_at)}</span>
                  </div>
                  <div className="h-1.5 bg-white/20 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-white/70 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-5 w-fit">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${tab === tb.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-gray-400">{t('loading')}</div>
      ) : tab === 'packages' ? (
        packages.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-10 text-center space-y-3">
            <p className="text-gray-400 text-sm">{t('noPackages')}</p>
            <Link href="/student/book" className="inline-block text-sm text-[#6B1F3A] font-medium hover:underline">
              {t('browseClasses')}
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {packages.map((pkg) => {
              const pct = progressPercent(pkg.credits_remaining, pkg.credits_total)
              const expired = pkg.status !== 'active'
              const isOpen = expandedPkg === pkg.id
              const pkgTxs = history.filter(
                (tx) => tx.student_package_id === pkg.id && tx.type !== 'purchase'
              )
              return (
                <div key={pkg.id} className={`bg-white rounded-xl border border-gray-100 overflow-hidden ${expired ? 'opacity-60' : ''}`}>
                  <div className="h-1.5" style={{ backgroundColor: pkg.packages?.color ?? '#6B1F3A' }} />
                  <div className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="font-semibold text-gray-900">{pkg.packages?.name_en}</p>
                        <p className="text-xs text-gray-400">{pkg.schools?.name} · {pkg.schools?.city}</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
                        pkg.status === 'active' ? 'bg-green-100 text-green-600' :
                        pkg.status === 'expired' ? 'bg-gray-100 text-gray-500' :
                        'bg-red-100 text-red-500'
                      }`}>{pkg.status}</span>
                    </div>
                    <div className="mb-2">
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>{t('creditsRemaining', { count: pkg.credits_remaining })}</span>
                        <span>{t('creditsTotal', { count: pkg.credits_total })}</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: pkg.packages?.color ?? '#6B1F3A' }} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-xs text-gray-400">{t('expires', { date: formatDate(pkg.expires_at) })}</p>
                      <button
                        onClick={() => setExpandedPkg(isOpen ? null : pkg.id)}
                        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition"
                      >
                        {pkgTxs.length > 0 ? t('transactions', { count: pkgTxs.length }) : t('noUsageYet')}
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                        >
                          <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="border-t border-gray-100">
                      {pkgTxs.length === 0 ? (
                        <p className="text-xs text-gray-400 text-center py-4">{t('noCreditsUsed')}</p>
                      ) : (
                        <div className="divide-y divide-gray-50">
                          {pkgTxs.map((tx) => (
                            <div key={tx.id} className="flex items-center gap-3 px-4 py-3">
                              <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs ${
                                tx.type === 'refund' ? 'bg-green-100' :
                                tx.type === 'no_show' ? 'bg-red-100' :
                                'bg-[#6B1F3A]/10'
                              }`}>
                                {tx.type === 'refund' ? '↩' : tx.type === 'no_show' ? '✗' : '✓'}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">{tx.lesson_name}</p>
                                <p className="text-xs text-gray-400">
                                  {tx.lesson_date ? formatDate(tx.lesson_date) : formatShort(tx.date)}
                                  {tx.type === 'refund' && ` · ${t('txRefunded')}`}
                                  {tx.type === 'no_show' && ` · ${t('txNoShow')}`}
                                </p>
                              </div>
                              <p className={`text-sm font-semibold shrink-0 ${tx.credits > 0 ? 'text-green-600' : 'text-[#6B1F3A]'}`}>
                                {tx.credits > 0 ? '+' : ''}{tx.credits}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      ) : tab === 'subscriptions' ? (
        subscriptions.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
            <p className="text-gray-400 text-sm">{t('noSubscriptions')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {subscriptions.map((sub) => {
              const isUnlimited = sub.access_total === null
              const pct = isUnlimited ? 100 : progressPercent(sub.access_remaining ?? 0, sub.access_total ?? 1)
              return (
                <div key={sub.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  <div className="h-1.5" style={{ backgroundColor: sub.subscriptions_catalog?.color ?? '#1F3A6B' }} />
                  <div className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="font-semibold text-gray-900">{sub.subscriptions_catalog?.name_en}</p>
                        <p className="text-xs text-gray-400">{sub.schools?.name} · {sub.schools?.city}</p>
                      </div>
                      <div className="flex gap-1">
                        {sub.subscriptions_catalog?.is_vip && (
                          <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">VIP</span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
                          sub.status === 'active' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-500'
                        }`}>{sub.status}</span>
                      </div>
                    </div>
                    <div className="mb-2">
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>{isUnlimited ? t('unlimitedAccess') : t('accessesRemaining', { count: sub.access_remaining ?? 0 })}</span>
                        {!isUnlimited && <span>{t('accessesTotal', { count: sub.access_total ?? 0 })}</span>}
                      </div>
                      {!isUnlimited && (
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: sub.subscriptions_catalog?.color ?? '#1F3A6B' }} />
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">
                      {t('renews', { date: formatDate(sub.current_period_end) })} · {sub.subscriptions_catalog?.period_value} {sub.subscriptions_catalog?.period_unit}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        )
      ) : (
        /* Credits History */
        history.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
            <p className="text-gray-400 text-sm">{t('noHistory')}</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="divide-y divide-gray-50">
              {history.map((tx) => (
                <div key={tx.id} className="flex items-center gap-3 px-4 py-3">
                  <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                    tx.type === 'purchase'
                      ? 'bg-blue-100'
                      : tx.type === 'refund'
                      ? 'bg-green-100'
                      : tx.type === 'no_show'
                      ? 'bg-red-100'
                      : 'bg-[#6B1F3A]/10'
                  }`}>
                    {tx.type === 'purchase' ? '🛒' : tx.type === 'refund' ? '↩' : tx.type === 'no_show' ? '✗' : '✓'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{tx.lesson_name}</p>
                    <p className="text-xs text-gray-400">
                      {tx.school_name}
                      {tx.lesson_date && ` · ${formatShort(tx.lesson_date)}`}
                      {tx.type === 'purchase' && ` · ${t('txPurchased')}`}
                      {tx.type === 'refund' && ` · ${t('txRefunded')}`}
                      {tx.type === 'no_show' && ` · ${t('txNoShow')}`}
                    </p>
                    {tx.package_name && (
                      <p className="text-xs text-gray-400 truncate">{tx.package_name}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-sm font-semibold ${tx.credits > 0 ? 'text-green-600' : 'text-[#6B1F3A]'}`}>
                      {tx.credits > 0 ? '+' : ''}{tx.credits} credit{Math.abs(tx.credits) !== 1 ? 's' : ''}
                    </p>
                    <p className="text-xs text-gray-400">{formatShort(tx.date)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  )
}

export default function StudentPackagesPage() {
  return (
    <Suspense>
      <StudentPackagesContent />
    </Suspense>
  )
}
