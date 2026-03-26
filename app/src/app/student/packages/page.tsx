'use client'

import { useEffect, useState } from 'react'
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

export default function StudentPackagesPage() {
  const [tab, setTab] = useState<'packages' | 'subscriptions'>('packages')
  const [packages, setPackages] = useState<StudentPackage[]>([])
  const [subscriptions, setSubscriptions] = useState<StudentSubscription[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [pkgRes, subRes] = await Promise.all([
        fetch('/api/student/packages'),
        fetch('/api/student/subscriptions'),
      ])
      if (pkgRes.ok) setPackages(await pkgRes.json())
      if (subRes.ok) setSubscriptions(await subRes.json())
      setLoading(false)
    }
    load()
  }, [])

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  function progressPercent(remaining: number, total: number) {
    return total > 0 ? Math.round((remaining / total) * 100) : 0
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">My Access</h1>
        <p className="text-gray-500 text-sm mt-0.5">Your packages and subscriptions</p>
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-5 w-fit">
        {(['packages', 'subscriptions'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition capitalize ${tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {t}
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
      ) : (
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
      )}
    </div>
  )
}
