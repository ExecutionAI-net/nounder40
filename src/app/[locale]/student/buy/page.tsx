'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'

type Package = {
  id: string
  name_en: string
  description_en: string | null
  credits: number
  validity_days: number
  price: number
  color: string
  language?: string | null
  image_url?: string | null
  is_popular: boolean
  is_vip?: boolean
  is_recurring?: boolean
  recurring_interval?: string | null
  credits_rollover?: boolean
}

const LANG_FLAG: Record<string, string> = { it: '🇮🇹', en: '🇬🇧', es: '🇪🇸' }

type StudentPackage = {
  id: string
  credits_remaining: number
  credits_total: number
  expires_at: string
  next_renewal_at: string | null
  stripe_subscription_id: string | null
  status: string
  packages: {
    name_en: string
    color: string
    is_recurring: boolean
    recurring_interval: string | null
  } | null
  schools: { name: string; city: string } | null
}

type Invoice = {
  id: string
  amount_paid: number
  currency: string
  status: string | null
  created: number
  invoice_pdf: string | null
  hosted_invoice_url: string | null
}

type SubscriptionDetail = {
  subscription_id: string
  next_payment_at: number | null
  next_payment_amount: number | null
  cancel_at: number | null
  cancelled_at: number | null
  currency: string
  status: string
}

function BuyPage() {
  const t = useTranslations('student.buy')
  const searchParams = useSearchParams()
  const [packages, setPackages] = useState<Package[]>([])
  const [activePackages, setActivePackages] = useState<StudentPackage[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [subDetails, setSubDetails] = useState<SubscriptionDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [buying, setBuying] = useState<string | null>(null)
  const [openingPortal, setOpeningPortal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const redirectTo = searchParams.get('redirect') ?? ''
  const hasRecurring = activePackages.some(p => p.stripe_subscription_id && p.packages?.is_recurring)

  useEffect(() => {
    if (redirectTo) localStorage.setItem('buy_redirect', redirectTo)

    if (searchParams.get('payment') === 'cancelled') {
      setNotice(t('paymentCancelled'))
    }

    if (searchParams.get('payment') === 'success') {
      const dest = localStorage.getItem('buy_redirect')
      localStorage.removeItem('buy_redirect')
      if (dest) { window.location.replace(dest); return }
    }

    Promise.all([
      fetch('/api/student/school-packages', { cache: 'no-store' }).then(r => r.json()),
      fetch('/api/student/packages', { cache: 'no-store' }).then(r => r.json()),
      fetch('/api/stripe/invoices', { cache: 'no-store' }).then(r => r.ok ? r.json() : { invoices: [], subscriptions: [] }),
    ]).then(([pkgs, activePkgs, invData]) => {
      setPackages(Array.isArray(pkgs) ? pkgs : [])
      setActivePackages(Array.isArray(activePkgs) ? activePkgs : [])
      setInvoices(Array.isArray(invData?.invoices) ? invData.invoices : [])
      setSubDetails(Array.isArray(invData?.subscriptions) ? invData.subscriptions : [])
    }).catch(() => {}).finally(() => setLoading(false))
  }, [searchParams, redirectTo]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleBuy(packageId: string) {
    setBuying(packageId)
    setError(null)
    const res = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'package', product_id: packageId, redirect_to: redirectTo || undefined }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? t('somethingWentWrong')); setBuying(null); return }
    window.location.href = data.url
  }

  async function handleManageBilling() {
    setOpeningPortal(true)
    setError(null)
    const res = await fetch('/api/stripe/portal', { method: 'POST' })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? t('couldNotOpenPortal')); setOpeningPortal(false); return }
    window.location.href = data.url
  }

  const recurringActive = activePackages.filter(p => p.stripe_subscription_id && p.packages?.is_recurring)

  function getSubDetail(subId: string | null) {
    if (!subId) return null
    return subDetails.find(s => s.subscription_id === subId) ?? null
  }

  function intervalLabel(interval: string | null | undefined) {
    const key = interval ?? 'month'
    const map: Record<string, string> = {
      week: t('intervalWeek'),
      month: t('intervalMonth'),
      '3month': t('interval3Month'),
      year: t('intervalYear'),
    }
    return map[key] ?? key
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-gray-500 text-sm mt-0.5">{t('subtitle')}</p>
      </div>

      {notice && (
        <div className="mb-5 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700 flex justify-between">
          {notice}<button onClick={() => setNotice(null)} className="text-amber-500 text-xs ml-4">✕</button>
        </div>
      )}

      {error && (
        <div className="mb-5 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 flex justify-between">
          {error}<button onClick={() => setError(null)} className="text-red-400 text-xs ml-4">✕</button>
        </div>
      )}

      {/* Active recurring subscriptions */}
      {!loading && recurringActive.length > 0 && (
        <div className="mb-8 bg-white rounded-xl border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-800">{t('activeSubscriptions')}</h2>
            <button
              onClick={handleManageBilling}
              disabled={openingPortal}
              className="text-xs px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 transition"
            >
              {openingPortal ? t('opening') : t('manageSubscription')}
            </button>
          </div>

          <div className="space-y-4">
            {recurringActive.map(sp => {
              const detail = getSubDetail(sp.stripe_subscription_id)
              const color = sp.packages?.color ?? '#6B1F3A'
              const creditsUsed = sp.credits_total - sp.credits_remaining
              const creditPct = sp.credits_total > 0 ? Math.round((creditsUsed / sp.credits_total) * 100) : 0

              const refTs = detail?.cancel_at ?? detail?.next_payment_at ?? null
              const daysLeft = refTs ? Math.max(0, Math.ceil((refTs * 1000 - Date.now()) / 86400000)) : null

              return (
                <div key={sp.id} className="p-4 rounded-xl bg-gray-50 border border-gray-100">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-1.5 h-10 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{sp.packages?.name_en}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {intervalLabel(sp.packages?.recurring_interval)}
                        </p>
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 mt-0.5 ${
                      sp.status === 'active' ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'
                    }`}>
                      {sp.status === 'active' ? t('statusActive') : t('statusPastDue')}
                    </span>
                  </div>

                  {/* Credit usage progress bar */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-gray-500">{t('creditsUsed')}</span>
                      <span className="text-xs font-medium text-gray-700">
                        {creditsUsed} / {sp.credits_total}
                        <span className="text-gray-400 ml-1">({creditPct}%)</span>
                      </span>
                    </div>
                    <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${creditPct}%`, backgroundColor: color }}
                      />
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      {t('creditsRemaining', { count: sp.credits_remaining })}
                    </p>
                  </div>

                  {/* Days left countdown + next payment */}
                  <div className="flex items-center justify-between text-xs">
                    {detail?.cancel_at ? (
                      <span className="text-amber-600 font-medium">
                        ⚠ {t('cancelsOn', { date: new Date(detail.cancel_at * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) })}
                        {daysLeft !== null && <> · {t('daysLeft', { count: daysLeft })}</>}
                      </span>
                    ) : detail?.next_payment_at ? (
                      <span className="text-gray-500">
                        {t('nextPayment')} <span className="font-medium text-gray-700">
                          {new Date(detail.next_payment_at * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                      </span>
                    ) : <span />}

                    <div className="flex items-center gap-3">
                      {daysLeft !== null && !detail?.cancel_at && (
                        <span className={`font-semibold ${daysLeft <= 3 ? 'text-red-500' : daysLeft <= 7 ? 'text-amber-500' : 'text-gray-500'}`}>
                          {t('daysLeft', { count: daysLeft })}
                        </span>
                      )}
                      {detail?.next_payment_amount != null && !detail?.cancel_at && (
                        <span className="font-semibold text-gray-700">
                          {new Intl.NumberFormat('en-EU', { style: 'currency', currency: detail.currency.toUpperCase() }).format(detail.next_payment_amount / 100)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Invoice history */}
          {invoices.length > 0 && (
            <div className="mt-4 border-t border-gray-100 pt-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{t('paymentHistory')}</h3>
              <div className="space-y-2">
                {invoices.slice(0, 8).map(inv => (
                  <div key={inv.id} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-3">
                      <span className="text-gray-400 text-xs w-24 flex-shrink-0">
                        {new Date(inv.created * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                      <span className="text-gray-700 font-medium">
                        {new Intl.NumberFormat('en-EU', { style: 'currency', currency: inv.currency.toUpperCase() }).format(inv.amount_paid / 100)}
                      </span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                        inv.status === 'paid' ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {inv.status === 'paid' ? t('invoiceStatusPaid') : inv.status}
                      </span>
                    </div>
                    {inv.invoice_pdf && (
                      <a href={inv.invoice_pdf} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-[#6B1F3A] hover:underline flex-shrink-0">
                        {t('downloadPdf')}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Package catalog */}
      {loading ? (
        <div className="text-sm text-gray-400">{t('loadingPackages')}</div>
      ) : packages.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-gray-400 text-sm">{t('noPackages')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {packages.map(pkg => (
            <div key={pkg.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden flex flex-col relative">
              {pkg.is_popular && (
                <div className="absolute top-3 right-3 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                  {t('mostPopular')}
                </div>
              )}
              {pkg.is_recurring && (
                <div className={`absolute ${pkg.is_popular ? 'top-9' : 'top-3'} right-3 text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium`}>
                  ↻ {intervalLabel(pkg.recurring_interval)}
                </div>
              )}
              <div className="h-1.5" style={{ backgroundColor: pkg.color }} />
              {pkg.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={pkg.image_url} alt="" className="w-full aspect-video object-cover" />
              )}
              <div className="p-6 flex flex-col flex-1">
                <p className="font-bold text-gray-900 text-lg mb-1">
                  {pkg.name_en}
                  {pkg.language && <span className="text-sm font-normal ml-2">{LANG_FLAG[pkg.language] ?? ''}</span>}
                  {pkg.is_vip && <span className="text-xs font-medium bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full ml-2 align-middle">VIP</span>}
                </p>
                {pkg.description_en && <p className="text-sm text-gray-400 mb-4">{pkg.description_en}</p>}

                <div className="mb-4">
                  <p className="text-4xl font-bold text-gray-900">€{Number(pkg.price).toFixed(0)}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {pkg.is_recurring
                      ? t('perInterval', { interval: intervalLabel(pkg.recurring_interval).toLowerCase() })
                      : t('oneTimePayment')}
                  </p>
                </div>

                <div className="space-y-2 mb-6 flex-1">
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <span className="text-[#6B1F3A] font-bold text-base">{pkg.credits}</span>
                    <span>{t('creditsIncluded')}</span>
                  </div>
                  {pkg.is_recurring ? (
                    <>
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <span className="text-gray-400">{t('renews')}</span>
                        <span className="font-medium">{intervalLabel(pkg.recurring_interval)}</span>
                      </div>
                      {pkg.credits_rollover && (
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                          <span>{t('creditsRollOver')}</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <span className="text-gray-400">{t('validFor')}</span>
                      <span className="font-medium">{pkg.validity_days} {t('days')}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <span>€{(pkg.price / pkg.credits).toFixed(2)} {t('perCredit')}</span>
                  </div>
                </div>

                <button
                  onClick={() => handleBuy(pkg.id)}
                  disabled={buying === pkg.id}
                  className="w-full py-3 rounded-xl text-sm font-semibold transition disabled:opacity-50"
                  style={{ backgroundColor: pkg.color, color: '#ffffff' }}
                >
                  {buying === pkg.id ? t('redirecting') : (pkg.is_recurring ? t('subscribe') : t('buyNow'))}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {hasRecurring && (
        <p className="mt-4 text-xs text-gray-400 text-center">
          {t('recurringDisclaimer')}
        </p>
      )}

      <p className="mt-6 text-xs text-gray-400 text-center">{t('securePayment')}</p>
    </div>
  )
}

export default function StudentBuyPage() {
  return <Suspense><BuyPage /></Suspense>
}
