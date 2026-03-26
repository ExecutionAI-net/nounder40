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

export default function HQPaymentsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterSchool, setFilterSchool] = useState('')

  const load = useCallback(async () => {
    const params = new URLSearchParams()
    if (filterStatus) params.set('status', filterStatus)
    if (filterSchool) params.set('school_id', filterSchool)
    const data = await fetch(`/api/hq/transactions?${params}`).then(r => r.ok ? r.json() : [])
    setTransactions(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [filterStatus, filterSchool])

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
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Payments</h1>
        <p className="text-gray-500 text-sm mt-0.5">Network-wide transaction overview and platform fee tracking</p>
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
      <div className="flex gap-3 mb-4">
        <select
          value={filterStatus}
          onChange={e => { setFilterStatus(e.target.value); setLoading(true) }}
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
          onChange={e => { setFilterSchool(e.target.value); setLoading(true) }}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
        >
          <option value="">All schools</option>
          {schools.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
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
