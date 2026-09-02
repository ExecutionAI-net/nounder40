'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { apiFetch, ApiError } from '@/lib/api/client'
import { formatCredits } from '@/lib/credits'
import { localizedName } from '@/lib/localized-name'

/**
 * "Aggiungi crediti" — una sola implementazione per le due strade da cui si
 * arriva: dalla scheda di un'allieva (che passa `student`) e dalla pagina
 * Crediti manuali, dove l'allieva va prima cercata. Duplicare il form avrebbe
 * significato due elenchi di motivi, due mappe dei metodi di pagamento e due
 * posti dove sbagliare il precompilamento dei pacchetti.
 */
type Student = { id: string; name: string; email?: string | null; phone?: string | null }

type SchoolPackage = {
  id: string
  name_it: string | null
  name_en: string | null
  name_fr: string | null
  name_es: string | null
  credits: number
  validity_days: number
  price: number
  active: boolean
}

type StudentRow = {
  students: { id: string; name: string; email: string; phone: string | null } | null
}

const EMPTY = {
  amount: '', reason: 'gift', note: '', expires_at: '',
  package_catalog_id: '', price: '', payment_method: 'cash',
}

export default function AddCreditsModal({ student, onClose, onDone }: {
  /** Preselezionata (dalla scheda allieva) o null: allora si cerca qui dentro. */
  student: Student | null
  onClose: () => void
  onDone?: () => void
}) {
  const t = useTranslations('school.students')
  const locale = useLocale()

  const [picked, setPicked] = useState<Student | null>(student)
  const [form, setForm] = useState(EMPTY)
  const [packages, setPackages] = useState<SchoolPackage[]>([])
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Ricerca allieva (solo quando non arriva gia' scelta)
  const [students, setStudents] = useState<Student[]>([])
  const [query, setQuery] = useState('')

  useEffect(() => {
    apiFetch<SchoolPackage[]>('/school/packages/')
      .then(d => setPackages((Array.isArray(d) ? d : []).filter(p => p.active)))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (student) return
    apiFetch<StudentRow[]>('/school/students/')
      .then(rows => setStudents(
        (Array.isArray(rows) ? rows : [])
          .map(r => r.students)
          .filter((s): s is NonNullable<StudentRow['students']> => !!s)
      ))
      .catch(() => {})
  }, [student])

  // Il nome del pacchetto nella lingua di chi guarda: prima mostrava sempre
  // name_en, che per alcuni pacchetti e' vuoto — in tendina si leggeva
  // "(20 credits)", senza nome.
  const packageName = (p: SchoolPackage) => localizedName(p, locale, t('unnamedPackage'))

  // "20.0" e' rumore; il mezzo credito esiste e va tenuto.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return students.slice(0, 8)
    return students.filter(s =>
      s.name?.toLowerCase().includes(q)
      || (s.email ?? '').toLowerCase().includes(q)
      || (s.phone ?? '').toLowerCase().includes(q)
    ).slice(0, 8)
  }, [students, query])

  const REASONS = [
    { value: 'gift', label: t('reasonGift') },
    { value: 'refund', label: t('reasonRefund') },
    { value: 'correction', label: t('reasonCorrection') },
    { value: 'compensation', label: t('reasonCompensation') },
    { value: 'other', label: t('reasonOther') },
  ]

  async function handleSave() {
    if (!picked || !form.amount || Number(form.amount) <= 0) return
    setSaving(true)
    setError(null)
    try {
      await apiFetch('/school/credits/grant/', {
        method: 'POST',
        body: JSON.stringify({
          student_id: picked.id,
          amount: Number(form.amount),
          reason: form.reason,
          note: form.note || null,
          expires_at: form.expires_at || null,
          package_catalog_id: form.package_catalog_id || null,
          price: form.price ? Number(form.price) : null,
          payment_method: form.payment_method,
        }),
      })
      setDone(true)
      setSaving(false)
      onDone?.()
      setTimeout(onClose, 1500)
    } catch (err) {
      const body = err instanceof ApiError && typeof err.body === 'object' && err.body
        ? (err.body as Record<string, unknown>) : null
      const first = body && Object.values(body).find(v => Array.isArray(v) && typeof v[0] === 'string')
      setError(
        (typeof body?.error === 'string' ? body.error : null)
        ?? (Array.isArray(first) ? String(first[0]) : null)
        ?? t('somethingWentWrong')
      )
      setSaving(false)
    }
  }

  const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full max-h-full overflow-y-auto space-y-4">
        <div>
          <h3 className="font-semibold text-gray-900 text-base">{t('addCreditsTitle')}</h3>
          {picked ? (
            <p className="text-sm text-gray-400 mt-0.5">
              {t('studentLabel')}: <span className="font-medium text-gray-700">{picked.name}</span>
              {!student && (
                <button onClick={() => { setPicked(null); setQuery('') }} className="ml-2 text-xs text-gray-400 underline hover:text-gray-600">
                  {t('changeStudent')}
                </button>
              )}
            </p>
          ) : (
            <p className="text-sm text-gray-400 mt-0.5">{t('pickStudentHint')}</p>
          )}
        </div>

        {done ? (
          <div className="py-4 text-center text-green-600 font-medium text-sm">✓ {t('creditsAdded')}</div>
        ) : !picked ? (
          /* Passo 1: chi. Si cerca per nome, email o telefono — al telefono si
             risponde con quello che si ha in mano. */
          <div className="space-y-2">
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('searchStudentPlaceholder')}
              className={inputCls}
            />
            <div className="max-h-64 overflow-y-auto space-y-1">
              {matches.length === 0 ? (
                <p className="text-sm text-gray-400 py-3 text-center">{t('noStudentFound')}</p>
              ) : matches.map(s => (
                <button
                  key={s.id}
                  onClick={() => setPicked(s)}
                  className="w-full text-left px-3 py-2 rounded-lg border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition"
                >
                  <p className="text-sm font-medium text-gray-900">{s.name}</p>
                  <p className="text-xs text-gray-400">{[s.email, s.phone].filter(Boolean).join(' · ')}</p>
                </button>
              ))}
            </div>
            <button onClick={onClose} className="w-full px-4 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition">
              {t('cancel')}
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div>
                <label className={labelCls}>{t('labelAmount')}</label>
                <input
                  type="number" min="1" value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder={t('amountPlaceholder')} className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls}>{t('labelReason')}</label>
                <select value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} className={inputCls}>
                  {REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>

              {packages.length > 0 && (
                <div>
                  <label className={labelCls}>
                    {t('creditPackage')} <span className="text-gray-400 font-normal">({t('optional')})</span>
                  </label>
                  <select
                    value={form.package_catalog_id}
                    onChange={e => {
                      const pkg = packages.find(p => p.id === e.target.value)
                      setForm(f => ({
                        ...f,
                        package_catalog_id: e.target.value,
                        amount: pkg ? formatCredits(pkg.credits) : f.amount,
                        price: pkg ? String(pkg.price) : f.price,
                      }))
                    }}
                    className={inputCls}
                  >
                    <option value="">{t('noPackageManualGrant')}</option>
                    {packages.map(p => (
                      <option key={p.id} value={p.id}>
                        {packageName(p)} — {t('creditsCount', { count: formatCredits(p.credits) })}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-400 mt-1">{t('packageAutoFill')}</p>
                </div>
              )}

              <div>
                <label className={labelCls}>
                  {t('expiryDate')} <span className="text-gray-400 font-normal">({t('onlyIfNoPackage')})</span>
                </label>
                <input
                  type="date" value={form.expires_at} disabled={!!form.package_catalog_id}
                  onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))}
                  className={`${inputCls} disabled:opacity-40 disabled:cursor-not-allowed`}
                />
                <p className="text-xs text-gray-400 mt-1">{form.package_catalog_id ? t('expiryFromPackage') : t('leaveBlankNoExpiry')}</p>
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                  <label className={labelCls}>
                    {t('pricePaid')} <span className="text-gray-400 font-normal">(€, {t('optional')})</span>
                  </label>
                  <input
                    type="number" min="0" step="0.01" value={form.price}
                    onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                    placeholder={t('pricePlaceholder')} className={inputCls}
                  />
                </div>
                <div className="flex-1">
                  <label className={labelCls}>{t('paymentMethod')}</label>
                  <select value={form.payment_method} onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))} className={inputCls}>
                    <option value="cash">{t('methodCash')}</option>
                    <option value="bank_transfer">{t('methodBankTransfer')}</option>
                    <option value="pos">{t('methodPOS')}</option>
                    <option value="other">{t('methodOther')}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className={labelCls}>{t('note')} <span className="text-gray-400 font-normal">({t('optional')})</span></label>
                <textarea
                  value={form.note} rows={2}
                  onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                  placeholder={t('notePlaceholder')} className={`${inputCls} resize-none`}
                />
              </div>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSave}
                disabled={saving || !form.amount || Number(form.amount) <= 0}
                className="flex-1 px-4 py-2.5 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700 disabled:opacity-50 transition"
              >
                {saving ? t('adding') : t('addCreditsTitle')}
              </button>
              <button onClick={onClose} className="px-4 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition">
                {t('cancel')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
