'use client'

import { useEffect, useState } from 'react'

interface Grant {
  id: string
  amount: number
  reason: string
  note: string | null
  created_at: string
  student: { name: string; email: string } | null
  granter: { name: string; email: string } | null
}

const REASON_LABELS: Record<string, string> = {
  gift: 'Gift',
  refund: 'Refund',
  correction: 'Correction',
  compensation: 'Compensation',
  other: 'Other',
}

const REASON_COLORS: Record<string, string> = {
  gift: 'bg-purple-50 text-purple-600',
  refund: 'bg-blue-50 text-blue-600',
  correction: 'bg-amber-50 text-amber-600',
  compensation: 'bg-green-50 text-green-600',
  other: 'bg-gray-100 text-gray-500',
}

export default function SchoolCreditsPage() {
  const [grants, setGrants] = useState<Grant[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch('/api/school/credits/grants')
      .then(r => r.json())
      .then(data => {
        setGrants(Array.isArray(data) ? data : [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const filtered = grants.filter(g => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      g.student?.name.toLowerCase().includes(q) ||
      g.student?.email.toLowerCase().includes(q) ||
      g.granter?.name.toLowerCase().includes(q) ||
      REASON_LABELS[g.reason]?.toLowerCase().includes(q) ||
      (g.note ?? '').toLowerCase().includes(q)
    )
  })

  const totalCredits = grants.reduce((sum, g) => sum + g.amount, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Manual Credits</h1>
          <p className="text-gray-500 text-sm mt-0.5">Credits manually granted to students by your team.</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-gray-900">{totalCredits}</p>
          <p className="text-xs text-gray-400">total credits granted</p>
        </div>
      </div>

      <div>
        <input
          type="text"
          placeholder="Search by student, granter, reason or note..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full max-w-sm border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20"
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">No manual credit grants yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Date</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Student</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Amount</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Reason</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Note</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Granted by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(g => (
                <tr key={g.id} className="hover:bg-gray-50 transition">
                  <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                    {new Date(g.created_at).toLocaleDateString('en-GB', {
                      day: 'numeric', month: 'short', year: 'numeric',
                    })}
                    <span className="block">
                      {new Date(g.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{g.student?.name ?? '—'}</p>
                    <p className="text-xs text-gray-400">{g.student?.email ?? ''}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-semibold text-gray-900">+{g.amount}</span>
                    <span className="text-gray-400 text-xs ml-1">credits</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${REASON_COLORS[g.reason] ?? 'bg-gray-100 text-gray-500'}`}>
                      {REASON_LABELS[g.reason] ?? g.reason}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs max-w-48">
                    {g.note ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-gray-700 text-xs font-medium">{g.granter?.name ?? '—'}</p>
                    <p className="text-xs text-gray-400">{g.granter?.email ?? ''}</p>
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
