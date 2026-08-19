'use client'

import { useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { apiFetch } from '@/lib/api/client'

interface Grant {
  id: string
  amount: number
  reason: string
  note: string | null
  created_at: string
  price: number | null
  payment_method: string | null
  package_name: string | null
  student: { name: string; email: string } | null
  granter: { name: string; email: string } | null
}

const REASON_COLORS: Record<string, string> = {
  gift: 'bg-purple-50 text-purple-600',
  refund: 'bg-blue-50 text-blue-600',
  correction: 'bg-amber-50 text-amber-600',
  compensation: 'bg-green-50 text-green-600',
  other: 'bg-gray-100 text-gray-500',
}

export default function SchoolCreditsPage() {
  const t = useTranslations('school.credits')
  const uiLocale = useLocale()

  const PAYMENT_METHOD_LABELS: Record<string, string> = {
    cash: t('methodCash'),
    bank_transfer: t('methodBankTransfer'),
    pos: t('methodPOS'),
    other: t('methodOther'),
  }

  const REASON_LABELS: Record<string, string> = {
    gift: t('reasonGift'),
    refund: t('reasonRefund'),
    correction: t('reasonCorrection'),
    compensation: t('reasonCompensation'),
    other: t('reasonOther'),
  }

  const [grants, setGrants] = useState<Grant[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    apiFetch<Grant[]>('/school/credits/grants/')
      .then((data) => setGrants(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false))
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
  const totalRevenue = grants.reduce((sum, g) => sum + (g.price ?? 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
          <p className="text-gray-500 text-sm mt-0.5">{t('subtitle')}</p>
        </div>
        <div className="flex gap-6 text-right">
          <div>
            <p className="text-2xl font-bold text-gray-900">{totalCredits}</p>
            <p className="text-xs text-gray-400">{t('totalCreditsGranted')}</p>
          </div>
          {totalRevenue > 0 && (
            <div>
              <p className="text-2xl font-bold text-[#6B1F3A]">€{totalRevenue.toFixed(2)}</p>
              <p className="text-xs text-gray-400">{t('totalRevenueManual')}</p>
            </div>
          )}
        </div>
      </div>

      <div>
        <input
          type="text"
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full max-w-sm border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20"
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">{t('loading')}</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">{t('noGrants')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{t('colDate')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{t('colStudent')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{t('colAmount')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{t('colPackage')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{t('colPricePaid')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{t('colReason')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{t('colNote')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{t('colGrantedBy')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(g => (
                <tr key={g.id} className="hover:bg-gray-50 transition">
                  <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                    {new Date(g.created_at).toLocaleDateString(uiLocale, {
                      day: 'numeric', month: 'short', year: 'numeric',
                    })}
                    <span className="block">
                      {new Date(g.created_at).toLocaleTimeString(uiLocale, { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{g.student?.name ?? '—'}</p>
                    <p className="text-xs text-gray-400">{g.student?.email ?? ''}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-semibold text-gray-900">+{g.amount}</span>
                    <span className="text-gray-400 text-xs ml-1">{t('credits')}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {g.package_name ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">
                    {g.price ? (
                      <>
                        <span className="font-semibold text-gray-900">€{g.price.toFixed(2)}</span>
                        {g.payment_method && (
                          <span className="block text-gray-400 mt-0.5">
                            {PAYMENT_METHOD_LABELS[g.payment_method] ?? g.payment_method}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
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
