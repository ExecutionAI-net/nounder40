'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

type Subscription = {
  id: string
  name_en: string
  name_it: string | null
  description_en: string | null
  period_value: number
  period_unit: string
  access_count: number | null
  price: number
  auto_renewal: boolean
  is_vip: boolean
  color: string
  active: boolean
}

const COLORS = ['#6B1F3A', '#1F3A6B', '#1F6B3A', '#6B5A1F', '#3A1F6B', '#4A4A4A']

const emptyForm = {
  name_en: '', name_it: '', description_en: '',
  period_value: '1', period_unit: 'months',
  access_count: '', price: '',
  color: '#1F3A6B', auto_renewal: true, is_vip: false,
}

export default function SchoolSubscriptionsPage() {
  const t = useTranslations('school.subscriptions')
  const [subs, setSubs] = useState<Subscription[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Subscription | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const res = await fetch('/api/school/subscriptions', { cache: 'no-store' })
    if (res.ok) setSubs(await res.json())
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setError(null)
    setShowForm(true)
  }

  function openEdit(sub: Subscription) {
    setEditing(sub)
    setForm({
      name_en: sub.name_en,
      name_it: sub.name_it ?? '',
      description_en: sub.description_en ?? '',
      period_value: String(sub.period_value),
      period_unit: sub.period_unit,
      access_count: sub.access_count != null ? String(sub.access_count) : '',
      price: String(sub.price),
      color: sub.color,
      auto_renewal: sub.auto_renewal,
      is_vip: sub.is_vip,
    })
    setError(null)
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.name_en || !form.period_value || !form.price) {
      setError('Name, period and price are required.')
      return
    }
    setSaving(true)
    setError(null)
    const method = editing ? 'PATCH' : 'POST'
    const url = editing ? `/api/school/subscriptions/${editing.id}` : '/api/school/subscriptions'
    const payload = { ...form, access_count: form.access_count ? Number(form.access_count) : null }
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      setShowForm(false)
      load()
    } else {
      const d = await res.json()
      setError(d.error ?? 'Something went wrong')
    }
    setSaving(false)
  }

  async function handleToggle(sub: Subscription) {
    await fetch(`/api/school/subscriptions/${sub.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !sub.active }),
    })
    load()
  }

  const inputCls = 'w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

  function periodLabel(sub: Subscription) {
    return `${sub.period_value} ${sub.period_unit}`
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
          <p className="text-gray-500 text-sm mt-0.5">{t('subtitle')}</p>
        </div>
        <button onClick={openCreate} className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition">
          {t('newSubscription')}
        </button>
      </div>

      {showForm && (
        <div className="mb-6 bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">{editing ? t('editSubscription') : t('newSubscription')}</h2>
          {error && <div className="mb-3 p-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>{t('labelNameEn')}</label>
              <input value={form.name_en} onChange={(e) => setForm(f => ({ ...f, name_en: e.target.value }))} className={inputCls} placeholder="e.g. Monthly Unlimited" />
            </div>
            <div>
              <label className={labelCls}>{t('labelNameIt')}</label>
              <input value={form.name_it} onChange={(e) => setForm(f => ({ ...f, name_it: e.target.value }))} className={inputCls} placeholder="e.g. Mensile Illimitato" />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>{t('labelDescription')}</label>
              <input value={form.description_en} onChange={(e) => setForm(f => ({ ...f, description_en: e.target.value }))} className={inputCls} placeholder="Short description..." />
            </div>
            <div>
              <label className={labelCls}>{t('labelPeriod')}</label>
              <div className="flex gap-2">
                <input type="number" min="1" value={form.period_value} onChange={(e) => setForm(f => ({ ...f, period_value: e.target.value }))} className={inputCls} style={{ width: '80px' }} />
                <select value={form.period_unit} onChange={(e) => setForm(f => ({ ...f, period_unit: e.target.value }))} className={inputCls}>
                  <option value="days">{t('days')}</option>
                  <option value="weeks">{t('weeks')}</option>
                  <option value="months">{t('months')}</option>
                  <option value="years">{t('years')}</option>
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls}>{t('labelAccessCount')}</label>
              <input type="number" min="1" value={form.access_count} onChange={(e) => setForm(f => ({ ...f, access_count: e.target.value }))} className={inputCls} placeholder="Unlimited" />
            </div>
            <div>
              <label className={labelCls}>{t('labelPrice')}</label>
              <input type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm(f => ({ ...f, price: e.target.value }))} className={inputCls} placeholder="0.00" />
            </div>
            <div>
              <label className={labelCls}>{t('labelColor')}</label>
              <div className="flex gap-2 mt-1 flex-wrap items-center">
                {COLORS.map((c) => (
                  <button key={c} type="button" onClick={() => setForm(f => ({ ...f, color: c }))}
                    className="w-7 h-7 rounded-full border-2 transition"
                    style={{ backgroundColor: c, borderColor: form.color === c ? '#1f2937' : 'transparent' }} />
                ))}
                <label
                  className="w-7 h-7 rounded-full border-2 border-dashed border-gray-300 cursor-pointer overflow-hidden relative flex items-center justify-center hover:border-gray-400 transition"
                  title="Custom color"
                  style={!COLORS.includes(form.color) ? { borderColor: '#1f2937', borderStyle: 'solid', backgroundColor: form.color } : {}}
                >
                  <input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                    className="absolute opacity-0 w-full h-full cursor-pointer" />
                  {COLORS.includes(form.color) && <span className="text-gray-400 text-xs leading-none select-none">+</span>}
                </label>
              </div>
            </div>
            <div className="col-span-2 flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.auto_renewal} onChange={(e) => setForm(f => ({ ...f, auto_renewal: e.target.checked }))} className="w-4 h-4 accent-[#6B1F3A]" />
                <span className="text-sm text-gray-700">{t('autoRenewal')}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_vip} onChange={(e) => setForm(f => ({ ...f, is_vip: e.target.checked }))} className="w-4 h-4 accent-[#6B1F3A]" />
                <span className="text-sm text-gray-700">{t('vip')}</span>
              </label>
            </div>
          </div>
          <div className="flex gap-3 mt-5">
            <button onClick={handleSave} disabled={saving} className="px-5 py-2 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] disabled:opacity-50 transition">
              {saving ? t('saving') : (editing ? t('saveChanges') : t('createSubscription'))}
            </button>
            <button onClick={() => setShowForm(false)} className="px-5 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition">
              {t('cancel')}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-400">{t('loading')}</div>
      ) : subs.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
          <p className="text-gray-400 text-sm">{t('noSubscriptions')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {subs.map((sub) => (
            <div key={sub.id} className={`bg-white rounded-xl border border-gray-100 overflow-hidden ${!sub.active ? 'opacity-50' : ''}`}>
              <div className="h-2" style={{ backgroundColor: sub.color }} />
              <div className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-semibold text-gray-900">{sub.name_en}</p>
                    {sub.name_it && <p className="text-xs text-gray-400">{sub.name_it}</p>}
                  </div>
                  <div className="flex gap-1">
                    {sub.is_vip && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">VIP</span>}
                    {sub.auto_renewal && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Auto</span>}
                  </div>
                </div>
                {sub.description_en && <p className="text-xs text-gray-500 mb-3">{sub.description_en}</p>}
                <div className="flex gap-4 text-sm mb-4">
                  <div>
                    <p className="text-xs text-gray-400">{t('colPeriod')}</p>
                    <p className="font-bold text-gray-900">{periodLabel(sub)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">{t('colAccess')}</p>
                    <p className="font-bold text-gray-900">{sub.access_count ?? '∞'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">{t('colPrice')}</p>
                    <p className="font-bold text-gray-900">€{Number(sub.price).toFixed(2)}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => openEdit(sub)} className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 transition">{t('edit')}</button>
                  <button onClick={() => handleToggle(sub)} className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 transition">
                    {sub.active ? t('deactivate') : t('activate')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
