'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { localizedName, type TranslatedNames } from '@/lib/localized-name'
import { apiFetch, ApiError } from '@/lib/api/client'
import MultiFilterSelect from '@/components/ui/MultiFilterSelect'
import { formatMoney } from '@/lib/format-money'

type Transaction = {
  id: string
  type: string
  // the package / product behind the row (null for manual credits without a catalog row)
  product_id: string | null
  product_name: string
  // live translations of the package behind product_id (null for shop orders / deleted packages)
  product_names?: TranslatedNames
  // DRF serializes DecimalField as a string (COERCE_DECIMAL_TO_STRING) — wrap with Number() before math/.toFixed().
  amount: string
  currency: string
  platform_fee: string
  school_amount: string
  payment_method: string
  stripe_payment_id: string | null
  status: 'completed' | 'pending' | 'refunded' | 'failed'
  created_at: string
  students: { id: string; name: string; email: string } | null
}

type StripeStatus = {
  connected: boolean
  onboarding_complete: boolean
  account_id: string | null
}

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  refunded: 'bg-gray-100 text-gray-600',
  failed: 'bg-red-100 text-red-600',
}

function SchoolPaymentsPage() {
  const t = useTranslations('school.payments')
  const uiLocale = useLocale()
  // The package's name in the viewer's language; the name frozen at purchase only as fallback
  const productName = (tx: Transaction) => localizedName(tx.product_names, uiLocale, tx.product_name ?? '')
  const searchParams = useSearchParams()

  const METHOD_LABELS: Record<string, string> = {
    stripe: t('methodCard'),
    cash: t('methodCash'),
    bank_transfer: t('methodBankTransfer'),
    pos: t('methodPOS'),
    paypal: t('methodPayPal'),
  }
  const STATUS_LABELS: Record<string, string> = {
    completed: t('completed'),
    pending: t('pending'),
    refunded: t('refunded'),
    failed: t('failed'),
  }
  // I18N-R3-06: `tx.type` is a raw enum from the API and was rendered with a
  // CSS `capitalize`, so every non-English locale read "Package" /
  // "Subscription". Same shape as STATUS_LABELS right above; an unknown
  // value still shows itself rather than disappearing.
  const TYPE_LABELS: Record<string, string> = {
    package: t('typePackage'),
    subscription: t('typeSubscription'),
    video: t('typeVideo'),
    shop: t('typeShop'),
    manual: t('typeManual'),
  }
  const [stripeStatus, setStripeStatus] = useState<StripeStatus | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  // Period: sent to the server (the list is capped at 1000 rows, so an old
  // month must be asked for, not sliced client-side). The other filters
  // work on the rows that came back.
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [filterProduct, setFilterProduct] = useState<string[]>([])
  const [connecting, setConnecting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refunding, setRefunding] = useState<string | null>(null)
  // Carlo's rule (I18N-R4-14): filters are multi-select, with a label
  const [filterStatus, setFilterStatus] = useState<string[]>([])
  const [filterMethod, setFilterMethod] = useState<string[]>([])
  const [onboardNotice, setOnboardNotice] = useState<string | null>(null)

  const loadStripeStatus = useCallback(async () => {
    setStripeStatus(await apiFetch<StripeStatus>('/stripe/onboard/status/').catch(() => null))
  }, [])

  const loadTransactions = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filterFrom) params.set('date_from', filterFrom)
    if (filterTo) params.set('date_to', filterTo)
    const query = params.toString()
    const txData = await apiFetch<Transaction[]>(`/school/transactions/${query ? `?${query}` : ''}`).catch(() => [])
    setTransactions(Array.isArray(txData) ? txData : [])
    setLoading(false)
  }, [filterFrom, filterTo])

  useEffect(() => {
    const param = searchParams.get('onboard')
    if (param === 'success') setOnboardNotice(t('onboardSuccess'))
    else if (param === 'refresh') setOnboardNotice(t('onboardRefresh'))
    loadStripeStatus()
  }, [loadStripeStatus, searchParams, t])

  useEffect(() => { loadTransactions() }, [loadTransactions])

  async function handleRefreshStatus() {
    setRefreshing(true)
    await loadStripeStatus()
    setRefreshing(false)
  }

  async function handleConnect() {
    setConnecting(true)
    try {
      const data = await apiFetch<{ url: string }>('/stripe/onboard/', { method: 'POST' })
      window.location.href = data.url
    } catch (err) {
      // Il paese della scuola va sistemato PRIMA di aprire l'account: Stripe
      // non permette di cambiarlo dopo. Messaggio esplicito, non generico.
      const body = err instanceof ApiError && typeof err.body === 'object' && err.body
        ? (err.body as { error?: string; country?: string | null })
        : null
      if (body?.error === 'school_country_missing') alert(t('errorCountryMissing'))
      else if (body?.error === 'school_country_unknown') alert(t('errorCountryUnknown', { country: body.country ?? '' }))
      else alert(t('errorStripeOnboarding'))
      setConnecting(false)
    }
  }

  async function handleRefund(txId: string) {
    if (!confirm(t('confirmRefund'))) return
    setRefunding(txId)
    try {
      await apiFetch('/stripe/refund/', { method: 'POST', body: JSON.stringify({ transaction_id: txId }) })
      setTransactions(prev =>
        prev.map(tx => tx.id === txId ? { ...tx, status: 'refunded' } : tx)
      )
    } catch {
      // no-op
    }
    setRefunding(null)
  }

  // One option per product sold in the period: the catalog row when there is
  // one (its name in the viewer's language), else the name frozen on the
  // transaction. Sorted in the viewer's language.
  const productKey = (tx: Transaction) => tx.product_id ?? `name:${tx.product_name ?? ''}`
  const productOptions = Array.from(
    transactions.reduce((acc, tx) => {
      const key = productKey(tx)
      if (!acc.has(key)) acc.set(key, productName(tx) || (TYPE_LABELS[tx.type] ?? tx.type))
      return acc
    }, new Map<string, string>()),
    ([value, label]) => ({ value, label }),
  ).sort((a, b) => a.label.localeCompare(b.label, uiLocale))

  const filtered = transactions.filter(tx => {
    if (filterStatus.length && !filterStatus.includes(tx.status)) return false
    if (filterMethod.length && !filterMethod.includes(tx.payment_method ?? '')) return false
    if (filterProduct.length && !filterProduct.includes(productKey(tx))) return false
    return true
  })
  const hasFilters = Boolean(filterFrom || filterTo) || filterStatus.length > 0 || filterMethod.length > 0 || filterProduct.length > 0
  function clearFilters() {
    setFilterFrom(''); setFilterTo(''); setFilterStatus([]); setFilterMethod([]); setFilterProduct([])
  }

  // The totals follow the filters (Carlo, 2026-09-21): what the school
  // netted, what the platform kept, and how many payments — on the
  // completed rows of the filtered list, never on the whole history.
  const completed = filtered.filter(tx => tx.status === 'completed')
  const netRevenue = completed.reduce((sum, tx) => sum + Number(tx.school_amount), 0)
  const platformFees = completed.reduce((sum, tx) => sum + Number(tx.platform_fee), 0)
  const inputCls = 'px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20'

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-gray-500 text-sm mt-0.5">{t('subtitle')}</p>
      </div>

      {onboardNotice && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-700 flex justify-between items-center">
          {onboardNotice}
          <button onClick={() => setOnboardNotice(null)} className="text-blue-400 text-xs ml-4">✕</button>
        </div>
      )}

      {/* Stripe Connect Banner */}
      <div className={`rounded-xl border p-5 mb-6 ${
        stripeStatus?.onboarding_complete
          ? 'bg-green-50 border-green-200'
          : 'bg-amber-50 border-amber-200'
      }`}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className={`w-2 h-2 rounded-full ${stripeStatus?.onboarding_complete ? 'bg-green-500' : stripeStatus?.connected ? 'bg-yellow-500' : 'bg-gray-400'}`} />
              <p className={`font-semibold text-sm ${stripeStatus?.onboarding_complete ? 'text-green-800' : 'text-amber-800'}`}>
                {stripeStatus?.onboarding_complete
                  ? t('stripeConnected')
                  : stripeStatus?.connected
                    ? t('stripeOnboardingPending')
                    : t('connectStripe')}
              </p>
            </div>
            <p className={`text-xs ${stripeStatus?.onboarding_complete ? 'text-green-600' : 'text-amber-600'}`}>
              {stripeStatus?.onboarding_complete
                ? `Account ID: ${stripeStatus.account_id}`
                : stripeStatus?.connected
                  ? `Account ID: ${stripeStatus.account_id} · ${t('stripeOnboardingPendingDesc')}`
                  : t('stripeDisconnectedDesc')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {stripeStatus?.connected && !stripeStatus?.onboarding_complete && (
              <button
                onClick={handleRefreshStatus}
                disabled={refreshing}
                className="text-amber-700 border border-amber-300 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-amber-100 transition disabled:opacity-50"
              >
                {refreshing ? t('checking') : t('refreshStatus')}
              </button>
            )}
          {!stripeStatus?.onboarding_complete && (
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
            >
              {connecting ? t('redirecting') : stripeStatus?.connected ? t('continueOnboarding') : t('connectStripe')}
            </button>
          )}
          </div>
        </div>
      </div>

      {/* Filters — above the totals, which follow them */}
      <div className="flex flex-wrap gap-3 items-end mb-4">
        <div>
          <label className="block text-[11px] font-medium text-gray-400 mb-1">{t('filterFrom')}</label>
          <input type="date" value={filterFrom} max={filterTo || undefined}
            onChange={e => setFilterFrom(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-400 mb-1">{t('filterTo')}</label>
          <input type="date" value={filterTo} min={filterFrom || undefined}
            onChange={e => setFilterTo(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-400 mb-1">{t('allProducts')}</label>
          <MultiFilterSelect label={t('allProducts')} selected={filterProduct} onChange={setFilterProduct}
            options={productOptions} />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-400 mb-1">{t('allStatuses')}</label>
          <MultiFilterSelect label={t('allStatuses')} selected={filterStatus} onChange={setFilterStatus}
            options={[
              { value: 'completed', label: t('completed') }, { value: 'pending', label: t('pending') },
              { value: 'refunded', label: t('refunded') }, { value: 'failed', label: t('failed') },
            ]} />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-400 mb-1">{t('allMethods')}</label>
          <MultiFilterSelect label={t('allMethods')} selected={filterMethod} onChange={setFilterMethod}
            options={[
              { value: 'stripe', label: t('methodCardStripe') }, { value: 'cash', label: t('methodCash') },
              { value: 'bank_transfer', label: t('methodBankTransfer') }, { value: 'pos', label: t('methodPOS') },
              { value: 'paypal', label: t('methodPayPal') },
            ]} />
        </div>
        {hasFilters && (
          <button type="button" onClick={clearFilters} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5">
            {t('clearFilters')}
          </button>
        )}
      </div>

      {/* Totals: on the filtered rows, completed only */}
      <div className="grid grid-cols-3 gap-4 mb-2">
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{t('netRevenue')}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{formatMoney(netRevenue, uiLocale)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{t('platformFees')}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{formatMoney(platformFees, uiLocale)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{t('transactions')}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{completed.length}</p>
        </div>
      </div>
      <p className="text-[11px] text-gray-400 mb-6">{t(hasFilters ? 'totalsFiltered' : 'totalsAll')}</p>

      {/* Transactions Table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">{t('loading')}</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">{t('noTransactions')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('colDate')}</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('colStudent')}</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('colProduct')}</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('colMethod')}</th>
                <th className="text-right px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('colAmount')}</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('colStatus')}</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(tx => (
                <tr key={tx.id} className="hover:bg-gray-50 transition">
                  <td className="px-6 py-3 text-gray-500 whitespace-nowrap">
                    {new Date(tx.created_at).toLocaleDateString(uiLocale, { day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap">
                    {tx.students ? (
                      <div>
                        <p className="font-medium text-gray-900">{tx.students.name}</p>
                        <p className="text-xs text-gray-400">{tx.students.email}</p>
                      </div>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap">
                    <p className="text-gray-900">{productName(tx)}</p>
                    <p className="text-xs text-gray-400">{TYPE_LABELS[tx.type] ?? tx.type}</p>
                  </td>
                  <td className="px-6 py-3 text-gray-600 whitespace-nowrap">
                    {METHOD_LABELS[tx.payment_method] ?? tx.payment_method}
                  </td>
                  <td className="px-6 py-3 text-right whitespace-nowrap">
                    <p className="font-semibold text-gray-900">{formatMoney(Number(tx.school_amount), uiLocale)}</p>
                    {Number(tx.platform_fee) > 0 && (
                      <p className="text-xs text-gray-400">{t('feeLabel')}: {formatMoney(Number(tx.platform_fee), uiLocale)}</p>
                    )}
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[tx.status]}`}>
                      {STATUS_LABELS[tx.status] ?? tx.status}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-right whitespace-nowrap">
                    {tx.status === 'completed' && tx.payment_method === 'stripe' && (
                      <button
                        onClick={() => handleRefund(tx.id)}
                        disabled={refunding === tx.id}
                        className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                      >
                        {refunding === tx.id ? t('refunding') : t('refund')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export default function SchoolPaymentsPageWrapper() {
  return (
    <Suspense>
      <SchoolPaymentsPage />
    </Suspense>
  )
}
