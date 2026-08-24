'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { apiFetch, ApiError } from '@/lib/api/client'

// Gestione codici sconto condivisa tra HQ (/api/hq/discount-codes, validi nel
// negozio HQ) e Scuola (/api/school/discount-codes, validi sui pacchetti della
// scuola). Stesso form, stessa tabella: cambia solo a chi appartengono.

export type DiscountCode = {
  id: string
  name: string
  code: string
  type: 'percentage' | 'fixed'
  value: number
  minimum_order: number | null
  expires_at: string | null
  max_uses: number | null
  usage_count: number
  applies_to: string[] | null
  active: boolean
}

// Ciò su cui il codice può essere applicato: prodotti (HQ) o pacchetti (scuola)
export type DiscountItem = { id: string; label: string }

const emptyForm = {
  name: '', code: '', type: 'percentage' as 'percentage' | 'fixed',
  value: '', minimum_order: '', expires_at: '', max_uses: '',
  applies_to: [] as string[],
}

// Codice suggerito: leggibile e senza caratteri ambigui (0/O, 1/I/L).
function suggestCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < 8; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)]
  return out
}

export default function DiscountCodesManager({
  apiBase,
  hint,
  loadItems,
}: {
  apiBase: string
  hint: string
  // Elenco di prodotti/pacchetti a cui il codice può essere limitato
  loadItems: () => Promise<DiscountItem[]>
}) {
  const t = useTranslations('discountCodes')
  const [items, setItems] = useState<DiscountItem[]>([])
  const [codes, setCodes] = useState<DiscountCode[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<DiscountCode | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    apiFetch<DiscountCode[]>(`${apiBase}/`)
      .then(rows => setCodes(Array.isArray(rows) ? rows : []))
      .catch(() => setCodes([]))
      .finally(() => setLoading(false))
  }, [apiBase])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadItems().then(setItems).catch(() => setItems([])) }, [loadItems])

  function openCreate() {
    setEditing(null)
    setForm({ ...emptyForm, code: suggestCode() })
    setError(null)
    setShowForm(true)
  }

  function openEdit(dc: DiscountCode) {
    setEditing(dc)
    setForm({
      name: dc.name,
      code: dc.code,
      type: dc.type,
      value: String(dc.value),
      minimum_order: dc.minimum_order != null ? String(dc.minimum_order) : '',
      // <input type="date"> vuole YYYY-MM-DD
      expires_at: dc.expires_at ? dc.expires_at.slice(0, 10) : '',
      max_uses: dc.max_uses != null ? String(dc.max_uses) : '',
      applies_to: dc.applies_to ?? [],
    })
    setError(null)
    setShowForm(true)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    const payload = {
      name: form.name.trim(),
      code: form.code.trim().toUpperCase(),
      type: form.type,
      value: Number(form.value) || 0,
      minimum_order: form.minimum_order === '' ? null : Number(form.minimum_order),
      // Fine giornata: un codice che "scade il 30" vale per tutto il 30.
      expires_at: form.expires_at === '' ? null : `${form.expires_at}T23:59:59Z`,
      max_uses: form.max_uses === '' ? null : Number(form.max_uses),
      // Lista vuota = vale su tutto il catalogo
      applies_to: form.applies_to,
    }
    try {
      await apiFetch(`${apiBase}/${editing ? `${editing.id}/` : ''}`, {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      })
      setShowForm(false)
      setEditing(null)
      load()
    } catch (err) {
      const body = err instanceof ApiError && typeof err.body === 'object' && err.body
        ? (err.body as { code?: string[] | string }) : undefined
      setError(body?.code ? t('errorDuplicate') : t('errorGeneric'))
    }
    setSaving(false)
  }

  async function handleToggle(dc: DiscountCode) {
    await apiFetch(`${apiBase}/${dc.id}/`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !dc.active }),
    }).catch(() => {})
    load()
  }

  async function handleDelete(dc: DiscountCode) {
    if (!confirm(t('deleteConfirm', { code: dc.code }))) return
    await apiFetch(`${apiBase}/${dc.id}/`, { method: 'DELETE' }).catch(() => {})
    load()
  }

  function valueLabel(dc: DiscountCode) {
    return dc.type === 'percentage' ? `−${Number(dc.value)}%` : `−€${Number(dc.value).toFixed(2)}`
  }

  const inputCls = 'w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-4">
        <p className="text-sm text-gray-500 max-w-2xl">{hint}</p>
        <button onClick={openCreate} className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition shrink-0">
          {t('new')}
        </button>
      </div>

      {showForm && (
        <div className="mb-6 bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">{editing ? t('edit') : t('new')}</h2>
          {error && <div className="mb-3 p-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>{t('fieldName')}</label>
              <input className={inputCls} value={form.name} placeholder={t('fieldNamePlaceholder')}
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>{t('fieldCode')}</label>
              <div className="flex gap-2">
                <input className={`${inputCls} font-mono uppercase`} value={form.code}
                  onChange={(e) => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} />
                <button type="button" onClick={() => setForm(f => ({ ...f, code: suggestCode() }))}
                  className="px-3 py-2 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 shrink-0">
                  {t('generate')}
                </button>
              </div>
            </div>
            <div>
              <label className={labelCls}>{t('fieldType')}</label>
              <select className={inputCls} value={form.type}
                onChange={(e) => setForm(f => ({ ...f, type: e.target.value as 'percentage' | 'fixed' }))}>
                <option value="percentage">{t('typePercentage')}</option>
                <option value="fixed">{t('typeFixed')}</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>{form.type === 'percentage' ? t('fieldValuePercent') : t('fieldValueFixed')}</label>
              <input className={inputCls} type="number" min="0" step="0.01" value={form.value}
                onChange={(e) => setForm(f => ({ ...f, value: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>{t('fieldMinimumOrder')}</label>
              <input className={inputCls} type="number" min="0" step="0.01" value={form.minimum_order}
                placeholder={t('optional')}
                onChange={(e) => setForm(f => ({ ...f, minimum_order: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>{t('fieldExpiresAt')}</label>
              <input className={inputCls} type="date" value={form.expires_at}
                onChange={(e) => setForm(f => ({ ...f, expires_at: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>{t('fieldMaxUses')}</label>
              <input className={inputCls} type="number" min="1" step="1" value={form.max_uses}
                placeholder={t('unlimitedPlaceholder')}
                onChange={(e) => setForm(f => ({ ...f, max_uses: e.target.value }))} />
            </div>

            {/* Su cosa vale: tutto il catalogo oppure solo le voci spuntate */}
            <div className="sm:col-span-2">
              <label className={labelCls}>{t('fieldAppliesTo')}</label>
              <div className="flex gap-2 mb-2">
                <button type="button" onClick={() => setForm(f => ({ ...f, applies_to: [] }))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${form.applies_to.length === 0 ? 'bg-[#6B1F3A] text-white border-[#6B1F3A]' : 'bg-white text-gray-600 border-gray-200'}`}>
                  {t('appliesToAll')}
                </button>
                <button type="button"
                  onClick={() => setForm(f => (f.applies_to.length === 0 && items[0] ? { ...f, applies_to: [items[0].id] } : f))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${form.applies_to.length > 0 ? 'bg-[#6B1F3A] text-white border-[#6B1F3A]' : 'bg-white text-gray-600 border-gray-200'}`}>
                  {t('appliesToSelected')}
                </button>
              </div>
              {form.applies_to.length > 0 && (
                <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-50">
                  {items.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-gray-400">{t('appliesToEmpty')}</p>
                  ) : items.map(item => (
                    <label key={item.id} className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer">
                      <input type="checkbox" className="w-3.5 h-3.5 rounded border-gray-300 cursor-pointer"
                        checked={form.applies_to.includes(item.id)}
                        onChange={() => setForm(f => ({
                          ...f,
                          applies_to: f.applies_to.includes(item.id)
                            ? f.applies_to.filter(id => id !== item.id)
                            : [...f.applies_to, item.id],
                        }))} />
                      <span className="truncate">{item.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="mt-5 flex gap-2">
            <button onClick={handleSave} disabled={saving || !form.name.trim() || !form.code.trim()}
              className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50">
              {saving ? t('saving') : t('save')}
            </button>
            <button onClick={() => { setShowForm(false); setEditing(null) }}
              className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition">
              {t('cancel')}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-400">{t('loading')}</div>
      ) : codes.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
          <p className="text-gray-400 text-sm">{t('empty')}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                <th className="px-4 py-3 font-medium">{t('colCode')}</th>
                <th className="px-4 py-3 font-medium">{t('colName')}</th>
                <th className="px-4 py-3 font-medium">{t('colValue')}</th>
                <th className="px-4 py-3 font-medium">{t('colAppliesTo')}</th>
                <th className="px-4 py-3 font-medium">{t('colConditions')}</th>
                <th className="px-4 py-3 font-medium">{t('colUses')}</th>
                <th className="px-4 py-3 font-medium">{t('colStatus')}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {codes.map(dc => {
                const expired = dc.expires_at != null && new Date(dc.expires_at) <= new Date()
                return (
                  <tr key={dc.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-3 font-mono font-semibold text-gray-900">{dc.code}</td>
                    <td className="px-4 py-3 text-gray-600">{dc.name}</td>
                    <td className="px-4 py-3 font-medium text-brand">{valueLabel(dc)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {dc.applies_to && dc.applies_to.length > 0
                        ? dc.applies_to
                            .map(id => items.find(i => i.id === id)?.label)
                            .filter(Boolean)
                            .join(', ') || t('appliesToCount', { count: dc.applies_to.length })
                        : t('appliesToAll')}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {dc.minimum_order != null && <div>{t('minimumOrderShort', { amount: Number(dc.minimum_order).toFixed(2) })}</div>}
                      <div className={expired ? 'text-red-500' : undefined}>
                        {dc.expires_at ? t('expiresOn', { date: new Date(dc.expires_at).toLocaleDateString() }) : t('noExpiry')}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {dc.max_uses != null ? `${dc.usage_count}/${dc.max_uses}` : dc.usage_count}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${dc.active && !expired ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                        {expired ? t('statusExpired') : dc.active ? t('statusActive') : t('statusInactive')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => openEdit(dc)} className="text-xs text-gray-500 hover:text-gray-800 mr-3">{t('editAction')}</button>
                      <button onClick={() => handleToggle(dc)} className="text-xs text-gray-500 hover:text-gray-800 mr-3">
                        {dc.active ? t('deactivate') : t('activate')}
                      </button>
                      <button onClick={() => handleDelete(dc)} className="text-xs text-red-400 hover:text-red-600">{t('deleteAction')}</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
