'use client'

import { useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { apiFetch } from '@/lib/api/client'
import AddCreditsModal from '@/components/school/AddCreditsModal'
import { formatCredits } from '@/lib/credits'

interface Grant {
  id: string
  amount: number
  reason: string
  note: string | null
  created_at: string
  price: number | null
  payment_method: string | null
  package_name: string | null
  lessons: number | null
  student: { name: string; email: string; phone?: string } | null
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
  const tStudents = useTranslations('school.students')
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

  const filterCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20'
  const filterLabelCls = 'block text-[11px] font-medium text-gray-500 mb-1'

  const [grants, setGrants] = useState<Grant[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  // Assegnare crediti si faceva solo dalla scheda di un'allieva: chi arriva
  // qui — la pagina che elenca proprio quelle assegnazioni — doveva uscire,
  // cercarla altrove e tornare. Stessa modale, con la ricerca dentro.
  const [adding, setAdding] = useState(false)

  function load() {
    apiFetch<Grant[]>('/school/credits/grants/')
      .then((data) => setGrants(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  // Una casella di testo sola non basta per una pagina contabile: qui si
  // cerca "quanto ho incassato in contanti a settembre" o "cosa ho dato a
  // Francesca", non una parola qualsiasi.
  const [reason, setReason] = useState('')
  const [pkg, setPkg] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [minPrice, setMinPrice] = useState('')

  const packageNames = [...new Set(grants.map(g => g.package_name).filter((n): n is string => !!n))].sort()

  const filtered = grants.filter(g => {
    if (search) {
      const q = search.toLowerCase()
      const hit = (
        g.student?.name.toLowerCase().includes(q) ||
        g.student?.email.toLowerCase().includes(q) ||
        (g.student?.phone ?? '').toLowerCase().includes(q) ||
        g.granter?.name.toLowerCase().includes(q) ||
        (g.note ?? '').toLowerCase().includes(q)
      )
      if (!hit) return false
    }
    if (reason && g.reason !== reason) return false
    if (pkg && g.package_name !== pkg) return false
    // Confronto sulla sola data: created_at ha anche l'ora, e "fino al 3"
    // deve includere tutto il 3.
    const day = g.created_at.slice(0, 10)
    if (from && day < from) return false
    if (to && day > to) return false
    if (minPrice && (g.price ?? 0) < Number(minPrice)) return false
    return true
  })

  const hasFilters = !!(search || reason || pkg || from || to || minPrice)
  function clearFilters() {
    setSearch(''); setReason(''); setPkg(''); setFrom(''); setTo(''); setMinPrice('')
  }

  // I totali seguono i filtri: un totale che parla di righe non visibili
  // e' peggio che nessun totale.
  const totalCredits = filtered.reduce((sum, g) => sum + Number(g.amount), 0)
  const totalRevenue = filtered.reduce((sum, g) => sum + Number(g.price ?? 0), 0)
  const totalLessons = filtered.reduce((sum, g) => sum + (g.lessons ?? 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
          <p className="text-gray-500 text-sm mt-0.5">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-6 text-right">
          <button
            onClick={() => setAdding(true)}
            className="px-4 py-2 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition whitespace-nowrap"
          >
            {tStudents('addCreditsTitle')}
          </button>
          {totalLessons > 0 && (
            <div>
              <p className="text-2xl font-bold text-gray-900">{totalLessons}</p>
              <p className="text-xs text-gray-400">{t('totalLessonsGranted')}</p>
            </div>
          )}
          <div>
            <p className="text-2xl font-bold text-gray-900">{formatCredits(totalCredits)}</p>
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

      <div className="bg-white rounded-xl border border-gray-100 p-3 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <label className={filterLabelCls}>{t('filterStudent')}</label>
          <input
            type="text"
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={filterCls}
          />
        </div>
        <div className="min-w-[150px]">
          <label className={filterLabelCls}>{t('colReason')}</label>
          <select value={reason} onChange={e => setReason(e.target.value)} className={filterCls}>
            <option value="">{t('filterAll')}</option>
            {Object.entries(REASON_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        {packageNames.length > 0 && (
          <div className="min-w-[170px]">
            <label className={filterLabelCls}>{t('colPackage')}</label>
            <select value={pkg} onChange={e => setPkg(e.target.value)} className={filterCls}>
              <option value="">{t('filterAll')}</option>
              {packageNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className={filterLabelCls}>{t('filterFrom')}</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={filterCls} />
        </div>
        <div>
          <label className={filterLabelCls}>{t('filterTo')}</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className={filterCls} />
        </div>
        <div className="w-28">
          <label className={filterLabelCls}>{t('filterMinPrice')}</label>
          <input type="number" min="0" step="0.01" value={minPrice} onChange={e => setMinPrice(e.target.value)} placeholder="0" className={filterCls} />
        </div>
        {hasFilters && (
          <button onClick={clearFilters} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-800 underline transition">
            {t('filterClear')}
          </button>
        )}
      </div>

      {/* overflow-x-auto, non overflow-hidden: con otto colonne la tabella
          era piu' larga dello schermo e le ultime restavano tagliate via,
          senza modo di raggiungerle. */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
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
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">{t('colAmount')}</th>
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
                    <p className="text-xs text-gray-400">
                      {[g.student?.email, g.student?.phone].filter(Boolean).join(' · ')}
                    </p>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {/* In lezioni per prima cosa: "le ho dato 10 lezioni" e'
                        la domanda vera; i crediti restano sotto. */}
                    {g.lessons != null ? (
                      <>
                        <span className="font-semibold text-gray-900">+{g.lessons}</span>
                        <span className="text-gray-400 text-xs ml-1">{t('lessonsShort')}</span>
                        <span className="block text-[11px] text-gray-400">+{formatCredits(g.amount)} {t('credits')}</span>
                      </>
                    ) : (
                      <>
                        <span className="font-semibold text-gray-900">+{formatCredits(g.amount)}</span>
                        <span className="text-gray-400 text-xs ml-1">{t('credits')}</span>
                      </>
                    )}
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
      {adding && (
        <AddCreditsModal
          student={null}
          onClose={() => setAdding(false)}
          onDone={load}
        />
      )}
    </div>
  )
}
