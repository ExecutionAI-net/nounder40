'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

type Transaction = {
  id: string
  type: string
  product_name: string
  amount: number
  currency: string
  platform_fee: number
  school_amount: number
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

const METHOD_LABELS: Record<string, string> = {
  stripe: 'Card',
  cash: 'Cash',
  bank_transfer: 'Bank Transfer',
  pos: 'POS',
  paypal: 'PayPal',
}

function SchoolPaymentsPage() {
  const searchParams = useSearchParams()
  const [stripeStatus, setStripeStatus] = useState<StripeStatus | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refunding, setRefunding] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterMethod, setFilterMethod] = useState('')
  const [onboardNotice, setOnboardNotice] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    const [statusRes, txRes] = await Promise.all([
      fetch('/api/stripe/onboard/status'),
      fetch('/api/school/transactions'),
    ])
    const statusData = await statusRes.json()
    const txData = await txRes.json()
    setStripeStatus(statusRes.ok ? statusData : null)
    setTransactions(Array.isArray(txData) ? txData : [])
    setLoading(false)
  }, [])

  useEffect(() => {
    const param = searchParams.get('onboard')
    if (param === 'success') setOnboardNotice('Stripe onboarding completed! Verifying your account...')
    else if (param === 'refresh') setOnboardNotice('Onboarding was interrupted. Please try connecting again.')
    loadData()
  }, [loadData, searchParams])

  async function handleRefreshStatus() {
    setRefreshing(true)
    await loadData()
    setRefreshing(false)
  }

  async function handleConnect() {
    setConnecting(true)
    try {
      const res = await fetch('/api/stripe/onboard', { method: 'POST' })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        alert(data.error ?? 'Failed to start Stripe onboarding. Check Stripe API key configuration.')
        setConnecting(false)
      }
    } catch {
      alert('Network error. Please try again.')
      setConnecting(false)
    }
  }

  async function handleRefund(txId: string) {
    if (!confirm('Refund this transaction? This cannot be undone.')) return
    setRefunding(txId)
    const res = await fetch('/api/stripe/refund', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction_id: txId }),
    })
    if (res.ok) {
      setTransactions(prev =>
        prev.map(tx => tx.id === txId ? { ...tx, status: 'refunded' } : tx)
      )
    }
    setRefunding(null)
  }

  const filtered = transactions.filter(tx => {
    if (filterStatus && tx.status !== filterStatus) return false
    if (filterMethod && tx.payment_method !== filterMethod) return false
    return true
  })

  const totalRevenue = transactions
    .filter(tx => tx.status === 'completed')
    .reduce((sum, tx) => sum + tx.school_amount, 0)

  const monthRevenue = transactions
    .filter(tx => tx.status === 'completed' && tx.created_at >= new Date(new Date().setDate(1)).toISOString())
    .reduce((sum, tx) => sum + tx.school_amount, 0)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Payments</h1>
        <p className="text-gray-500 text-sm mt-0.5">Stripe Connect status and transaction history</p>
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
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className={`w-2 h-2 rounded-full ${stripeStatus?.onboarding_complete ? 'bg-green-500' : stripeStatus?.connected ? 'bg-yellow-500' : 'bg-gray-400'}`} />
              <p className={`font-semibold text-sm ${stripeStatus?.onboarding_complete ? 'text-green-800' : 'text-amber-800'}`}>
                {stripeStatus?.onboarding_complete
                  ? 'Stripe Connected'
                  : stripeStatus?.connected
                    ? 'Stripe Account Created — Onboarding Pending'
                    : 'Connect Stripe to Accept Payments'}
              </p>
            </div>
            <p className={`text-xs ${stripeStatus?.onboarding_complete ? 'text-green-600' : 'text-amber-600'}`}>
              {stripeStatus?.onboarding_complete
                ? `Account ID: ${stripeStatus.account_id}`
                : stripeStatus?.connected
                  ? `Account ID: ${stripeStatus.account_id} · Complete your Stripe profile to accept payments`
                  : 'Connect your Stripe Express account to start accepting card payments from students.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {stripeStatus?.connected && !stripeStatus?.onboarding_complete && (
              <button
                onClick={handleRefreshStatus}
                disabled={refreshing}
                className="text-amber-700 border border-amber-300 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-amber-100 transition disabled:opacity-50"
              >
                {refreshing ? 'Checking...' : 'Refresh Status'}
              </button>
            )}
          {!stripeStatus?.onboarding_complete && (
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
            >
              {connecting ? 'Redirecting...' : stripeStatus?.connected ? 'Continue Onboarding' : 'Connect Stripe'}
            </button>
          )}
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">This Month</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">€{monthRevenue.toFixed(2)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Total Revenue</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">€{totalRevenue.toFixed(2)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Transactions</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{transactions.filter(t => t.status === 'completed').length}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
        >
          <option value="">All statuses</option>
          <option value="completed">Completed</option>
          <option value="pending">Pending</option>
          <option value="refunded">Refunded</option>
          <option value="failed">Failed</option>
        </select>
        <select
          value={filterMethod}
          onChange={e => setFilterMethod(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
        >
          <option value="">All methods</option>
          <option value="stripe">Card (Stripe)</option>
          <option value="cash">Cash</option>
          <option value="bank_transfer">Bank Transfer</option>
          <option value="pos">POS</option>
          <option value="paypal">PayPal</option>
        </select>
      </div>

      {/* Transactions Table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">No transactions found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Date</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Student</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Product</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Method</th>
                <th className="text-right px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Amount</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Status</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(tx => (
                <tr key={tx.id} className="hover:bg-gray-50 transition">
                  <td className="px-6 py-3 text-gray-500 whitespace-nowrap">
                    {new Date(tx.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-6 py-3">
                    {tx.students ? (
                      <div>
                        <p className="font-medium text-gray-900">{tx.students.name}</p>
                        <p className="text-xs text-gray-400">{tx.students.email}</p>
                      </div>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-6 py-3">
                    <p className="text-gray-900">{tx.product_name}</p>
                    <p className="text-xs text-gray-400 capitalize">{tx.type}</p>
                  </td>
                  <td className="px-6 py-3 text-gray-600">
                    {METHOD_LABELS[tx.payment_method] ?? tx.payment_method}
                  </td>
                  <td className="px-6 py-3 text-right">
                    <p className="font-semibold text-gray-900">€{tx.school_amount.toFixed(2)}</p>
                    {tx.platform_fee > 0 && (
                      <p className="text-xs text-gray-400">fee: €{tx.platform_fee.toFixed(2)}</p>
                    )}
                  </td>
                  <td className="px-6 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[tx.status]}`}>
                      {tx.status}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-right">
                    {tx.status === 'completed' && tx.payment_method === 'stripe' && (
                      <button
                        onClick={() => handleRefund(tx.id)}
                        disabled={refunding === tx.id}
                        className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                      >
                        {refunding === tx.id ? 'Refunding...' : 'Refund'}
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
