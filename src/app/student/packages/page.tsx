'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

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
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<'packages' | 'subscriptions' | 'history'>('packages')
  const [packages, setPackages] = useState<StudentPackage[]>([])
  const [subscriptions, setSubscriptions] = useState<StudentSubscription[]>([])
  const [history, setHistory] = useState<CreditTx[]>([])
  const [totalCredits, setTotalCredits] = useState(0)
  const [activePackages, setActivePackages] = useState<PackageSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [paymentSuccess, setPaymentSuccess] = useState(false)

  async function load() {
    setLoading(true)
    const [pkgRes, subRes, credRes] = await Promise.all([
      fetch('/api/student/packages'),
      fetch('/api/student/subscriptions'),
      fetch('/api/student/credits'),
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
      // Verify session with Stripe and activate credits, then reload
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  function formatShort(d: string) {
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  }

  function progressPercent(remaining: number, total: number) {
    return total > 0 ? Math.round((remaining / total) * 100) : 0
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">My Access</h1>
        <p className="text-gray-500 text-sm mt-0.5">Your packages, subscriptions and credit history</p>
      </div>

      {paymentSuccess && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700 flex justify-between items-center">
          Payment successful! Your credits are being activated...
          <button onClick={() => setPaymentSuccess(false)} className="text-green-400 text-xs ml-4">✕</button>
        </div>
      )}

      {/* Credit summary card */}
      <div className="bg-[#6B1F3A] rounded-2xl p-5 mb-5 text-white">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-white/70 text-xs uppercase tracking-wide font-medium mb-1">Total Credits Available</p>
            <p className="text-5xl font-bold leading-none">{loading ? '—' : totalCredits}</p>
            <p className="text-white/60 text-xs mt-2">across all active packages</p>
          </div>
          <div className="bg-white/10 rounded-xl p-3">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-white">
              <path d="M2.25 2.25a.75.75 0 0 0 0 1.5h1.386c.17 0 .318.114.362.278l2.558 9.592a3.752 3.752 0 0 0-2.806 3.63c0 .414.336.75.75.75h15.75a.75.75 0 0 0 0-1.5H5.378A2.25 2.25 0 0 1 7.5 15h11.218a.75.75 0 0 0 .674-.421 60.358 60.358 0 0 0 2.96-7.228.75.75 0 0 0-.525-.965A60.864 60.864 0 0 0 5.68 4.509l-.232-.867A1.875 1.875 0 0 0 3.636 2.25H2.25Z" />
              <path d="M3.75 20.25a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0ZM16.5 20.25a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Z" />
            </svg>
          </div>
        </div>

        {/* Per-package breakdown */}
        {!loading && activePackages.length > 0 && (
          <div className="mt-4 space-y-2">
            {activePackages.map((p) => {
              const pct = progressPercent(p.credits_remaining, p.credits_total)
              return (
                <div key={p.id}>
                  <div className="flex justify-between text-xs text-white/80 mb-1">
                    <span>{p.packages?.name_en ?? 'Package'} · {p.schools?.name}</span>
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
        {(['packages', 'subscriptions', 'history'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition capitalize ${tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {t === 'history' ? 'Credits History' : t}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-gray-400">Loading...</div>
      ) : tab === 'packages' ? (
        packages.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-10 text-center space-y-3">
            <p className="text-gray-400 text-sm">No packages yet.</p>
            <Link href="/student/book" className="inline-block text-sm text-[#6B1F3A] font-medium hover:underline">
              Browse classes →
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {packages.map((pkg) => {
              const pct = progressPercent(pkg.credits_remaining, pkg.credits_total)
              const expired = pkg.status !== 'active'
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
                        <span>{pkg.credits_remaining} credits remaining</span>
                        <span>{pkg.credits_total} total</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: pkg.packages?.color ?? '#6B1F3A' }} />
                      </div>
                    </div>
                    <p className="text-xs text-gray-400">Expires {formatDate(pkg.expires_at)}</p>
                  </div>
                </div>
              )
            })}
          </div>
        )
      ) : tab === 'subscriptions' ? (
        subscriptions.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
            <p className="text-gray-400 text-sm">No active subscriptions.</p>
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
                        <span>{isUnlimited ? 'Unlimited access' : `${sub.access_remaining} accesses remaining`}</span>
                        {!isUnlimited && <span>{sub.access_total} total</span>}
                      </div>
                      {!isUnlimited && (
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: sub.subscriptions_catalog?.color ?? '#1F3A6B' }} />
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">
                      Renews {formatDate(sub.current_period_end)} · {sub.subscriptions_catalog?.period_value} {sub.subscriptions_catalog?.period_unit}
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
            <p className="text-gray-400 text-sm">No credit transactions yet.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="divide-y divide-gray-50">
              {history.map((tx) => (
                <div key={tx.id} className="flex items-center gap-3 px-4 py-3">
                  {/* Icon */}
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
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{tx.lesson_name}</p>
                    <p className="text-xs text-gray-400">
                      {tx.school_name}
                      {tx.lesson_date && ` · ${formatShort(tx.lesson_date)}`}
                      {tx.type === 'purchase' && ' · Purchased'}
                      {tx.type === 'refund' && ' · Refunded'}
                      {tx.type === 'no_show' && ' · No-show'}
                    </p>
                    {tx.package_name && (
                      <p className="text-xs text-gray-400 truncate">{tx.package_name}</p>
                    )}
                  </div>
                  {/* Amount */}
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
