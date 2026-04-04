'use client'

import { useEffect, useState, useCallback } from 'react'

type Transaction = {
  id: string
  type: string
  product_name: string
  amount: number | null
  currency: string
  platform_fee: number | null
  school_amount: number | null
  payment_method: string
  status: 'completed' | 'pending' | 'refunded' | 'failed'
  created_at: string
  schools: { id: string; name: string; city: string } | null
  students: { id: string; name: string; email: string } | null
}

const fmt = (v: number | null | undefined) => (v ?? 0).toFixed(2)

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  refunded: 'bg-gray-100 text-gray-600',
  failed: 'bg-red-100 text-red-600',
}

function exportCSV(transactions: Transaction[]) {
  const headers = ['Date', 'School', 'City', 'Student', 'Email', 'Product', 'Type', 'Amount (€)', 'HQ Fee (€)', 'School Amount (€)', 'Status', 'Payment Method']
  const rows = transactions.map(tx => [
    new Date(tx.created_at).toLocaleDateString('en-GB'),
    tx.schools?.name ?? '',
    tx.schools?.city ?? '',
    tx.students?.name ?? '',
    tx.students?.email ?? '',
    tx.product_name ?? '',
    tx.type ?? '',
    fmt(tx.amount),
    fmt(tx.platform_fee),
    fmt(tx.school_amount),
    tx.status,
    tx.payment_method ?? '',
  ])
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `hq-transactions-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function HQPaymentsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterSchool, setFilterSchool] = useState('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filterStatus) params.set('status', filterStatus)
    if (filterSchool) params.set('school_id', filterSchool)
    if (filterFrom) params.set('from', filterFrom)
    if (filterTo) params.set('to', filterTo + 'T23:59:59')
    const data = await fetch(`/api/hq/transactions?${params}`).then(r => r.ok ? r.json() : [])
    setTransactions(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [filterStatus, filterSchool, filterFrom, filterTo])

  useEffect(() => { load() }, [load])

  const completedTx = transactions.filter(tx => tx.status === 'completed')
  const totalRevenue = completedTx.reduce((sum, tx) => sum + (tx.amount ?? 0), 0)
  const totalFees = completedTx.reduce((sum, tx) => sum + (tx.platform_fee ?? 0), 0)
  const monthRevenue = completedTx
    .filter(tx => tx.created_at >= new Date(new Date().setDate(1)).toISOString())
    .reduce((sum, tx) => sum + (tx.platform_fee ?? 0), 0)

  const schools = Array.from(
    new Map(transactions.map(tx => tx.schools).filter(Boolean).map(s => [s!.id, s!])).values()
  )

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payments</h1>
          <p className="text-gray-500 text-sm mt-0.5">Network-wide transaction overview and platform fee tracking</p>
        </div>
        <button
          onClick={() => exportCSV(transactions)}
          disabled={transactions.length === 0}
          className="flex items-center gap-2 text-sm border border-gray-200 bg-white px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
            <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
          </svg>
          Export CSV
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Total GMV</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">€{fmt(totalRevenue)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Platform Fees</p>
          <p className="text-2xl font-bold text-[#6B1F3A] mt-1">€{fmt(totalFees)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Fees This Month</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">€{fmt(monthRevenue)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Transactions</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{completedTx.length}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
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
          value={filterSchool}
          onChange={e => setFilterSchool(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
        >
          <option value="">All schools</option>
          {schools.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={filterFrom}
            onChange={e => setFilterFrom(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
          />
          <span className="text-gray-400 text-sm">→</span>
          <input
            type="date"
            value={filterTo}
            onChange={e => setFilterTo(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
          />
        </div>
        {(filterStatus || filterSchool || filterFrom || filterTo) && (
          <button
            onClick={() => { setFilterStatus(''); setFilterSchool(''); setFilterFrom(''); setFilterTo('') }}
            className="text-sm text-gray-400 hover:text-gray-600 px-2"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading...</div>
        ) : transactions.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">No transactions found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Date</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">School</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Student</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Product</th>
                <th className="text-right px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Amount</th>
                <th className="text-right px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">HQ Fee</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {transactions.map(tx => (
                <tr key={tx.id} className="hover:bg-gray-50 transition">
                  <td className="px-6 py-3 text-gray-500 whitespace-nowrap">
                    {new Date(tx.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-6 py-3">
                    {tx.schools ? (
                      <div>
                        <p className="font-medium text-gray-900">{tx.schools.name}</p>
                        <p className="text-xs text-gray-400">{tx.schools.city}</p>
                      </div>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-6 py-3">
                    {tx.students ? (
                      <div>
                        <p className="text-gray-900">{tx.students.name}</p>
                        <p className="text-xs text-gray-400">{tx.students.email}</p>
                      </div>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-6 py-3">
                    <p className="text-gray-900">{tx.product_name}</p>
                    <p className="text-xs text-gray-400 capitalize">{tx.type}</p>
                  </td>
                  <td className="px-6 py-3 text-right font-semibold text-gray-900">
                    €{fmt(tx.amount)}
                  </td>
                  <td className="px-6 py-3 text-right font-semibold text-[#6B1F3A]">
                    €{fmt(tx.platform_fee)}
                  </td>
                  <td className="px-6 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[tx.status]}`}>
                      {tx.status}
                    </span>
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
