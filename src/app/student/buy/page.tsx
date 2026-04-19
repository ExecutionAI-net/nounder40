'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

type Package = {
  id: string
  name_en: string
  description_en: string | null
  credits: number
  validity_days: number
  price: number
  color: string
  is_popular: boolean
}

function BuyPage() {
  const searchParams = useSearchParams()
  const [packages, setPackages] = useState<Package[]>([])
  const [loading, setLoading] = useState(true)
  const [buying, setBuying] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const redirectTo = searchParams.get('redirect') ?? ''

  useEffect(() => {
    if (searchParams.get('payment') === 'cancelled') {
      setNotice('Payment was cancelled. No charges were made.')
    }

    fetch('/api/hq/packages')
      .then(r => r.json())
      .then(d => setPackages(Array.isArray(d) ? d.filter((p: Package & { active: boolean }) => p.active) : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [searchParams])

  async function handleBuy(packageId: string) {
    setBuying(packageId)
    setError(null)
    const res = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'package', product_id: packageId, redirect_to: redirectTo || undefined }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? 'Something went wrong. Please try again.')
      setBuying(null)
      return
    }
    window.location.href = data.url
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Buy Credits</h1>
        <p className="text-gray-500 text-sm mt-0.5">Purchase a credit package to book lessons at your school</p>
      </div>

      {notice && (
        <div className="mb-5 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700 flex justify-between">
          {notice}
          <button onClick={() => setNotice(null)} className="text-amber-500 text-xs ml-4">✕</button>
        </div>
      )}

      {error && (
        <div className="mb-5 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 flex justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 text-xs ml-4">✕</button>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-400">Loading packages...</div>
      ) : packages.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-gray-400 text-sm">No packages available at the moment.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {packages.map(pkg => (
            <div key={pkg.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden flex flex-col relative">
              {pkg.is_popular && (
                <div className="absolute top-3 right-3 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                  Most Popular
                </div>
              )}
              <div className="h-1.5" style={{ backgroundColor: pkg.color }} />
              <div className="p-6 flex flex-col flex-1">
                <p className="font-bold text-gray-900 text-lg mb-1">{pkg.name_en}</p>
                {pkg.description_en && (
                  <p className="text-sm text-gray-400 mb-4">{pkg.description_en}</p>
                )}

                <div className="mb-4">
                  <p className="text-4xl font-bold text-gray-900">€{Number(pkg.price).toFixed(0)}</p>
                  <p className="text-xs text-gray-400 mt-1">one-time payment</p>
                </div>

                <div className="space-y-2 mb-6 flex-1">
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <span className="text-[#6B1F3A] font-bold text-base">{pkg.credits}</span>
                    <span>credits included</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <span className="text-gray-400">Valid for</span>
                    <span className="font-medium">{pkg.validity_days} days</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <span>€{(pkg.price / pkg.credits).toFixed(2)} per credit</span>
                  </div>
                </div>

                <button
                  onClick={() => handleBuy(pkg.id)}
                  disabled={buying === pkg.id}
                  className="w-full py-3 rounded-xl text-sm font-semibold transition disabled:opacity-50"
                  style={{
                    backgroundColor: pkg.color,
                    color: '#ffffff',
                  }}
                >
                  {buying === pkg.id ? 'Redirecting...' : 'Buy Now'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-6 text-xs text-gray-400 text-center">
        Secure payment via Stripe · Credits are valid at your registered school
      </p>
    </div>
  )
}

export default function StudentBuyPage() {
  return (
    <Suspense>
      <BuyPage />
    </Suspense>
  )
}
