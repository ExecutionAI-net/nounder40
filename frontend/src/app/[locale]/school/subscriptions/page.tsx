'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import ColorPicker from '@/components/ui/ColorPicker'
import ImageUploadInput from '@/components/ui/ImageUploadInput'

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
  is_popular: boolean
  color: string
  language: string | null
  image_url: string | null
  active: boolean
}

const LANGUAGES = [
  { value: 'it', label: 'Italiano' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
]

const LANG_FLAG: Record<string, string> = { it: '🇮🇹', en: '🇬🇧', es: '🇪🇸' }

const emptyForm = {
  name: '', description_en: '', language: 'it',
  period_value: '1', period_unit: 'months',
  access_count: '', price: '',
  color: '#1F3A6B', auto_renewal: true, is_vip: false, is_popular: false,
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

  function formFrom(sub: Subscription) {
    return {
      name: sub.name_en,
      description_en: sub.description_en ?? '',
      language: sub.language ?? 'it',
      period_value: String(sub.period_value),
      period_unit: sub.period_unit,
      access_count: sub.access_count != null ? String(sub.access_count) : '',
      price: String(sub.price),
      color: sub.color,
      auto_renewal: sub.auto_renewal,
      is_vip: sub.is_vip,
      is_popular: sub.is_popular ?? false,
    }
  }

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setError(null)
    setShowForm(true)
  }

  function openEdit(sub: Subscription) {
    setEditing(sub)
    setForm(formFrom(sub))
    setError(null)
    setShowForm(true)
  }

  // Duplica: form precompilato come nuovo abbonamento (per la versione in un'altra lingua)
  function openDuplicate(sub: Subscription) {
    setEditing(null)
    setForm(formFrom(sub))
    setError(null)
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleSave() {
    if (!form.name || !form.period_value || !form.price) {
      setError('Name, period and price are required.')
      return
    }
    setSaving(true)
    setError(null)
    const method = editing ? 'PATCH' : 'POST'
    const url = editing ? `/api/school/subscriptions/${editing.id}` : '/api/school/subscriptions'
    const { name, ...rest } = form
    const payload = { ...rest, name_en: name, name_it: name, access_count: form.access_count ? Number(form.access_count) : null }
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
              <label className={labelCls}>{t('labelName')}</label>
              <input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} className={inputCls} placeholder="e.g. Monthly Unlimited" />
            </div>
            <div>
              <label className={labelCls}>{t('labelLanguage')}</label>
              <select value={form.language} onChange={(e) => setForm(f => ({ ...f, language: e.target.value }))} className={inputCls}>
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>{LANG_FLAG[l.value]} {l.label}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">{t('languageHint')}</p>
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
              <ColorPicker value={form.color} onChange={(c) => setForm(f => ({ ...f, color: c }))} />
            </div>

            {/* Foto abbonamento: upload disponibile dopo il salvataggio */}
            <div className="col-span-2">
              {editing ? (
                <ImageUploadInput
                  endpoint={`/api/school/subscriptions/${editing.id}/image`}
                  imageUrl={editing.image_url}
                  onChange={(url) => {
                    setEditing(s => s ? { ...s, image_url: url } : s)
                    setSubs(prev => prev.map(s => s.id === editing.id ? { ...s, image_url: url } : s))
                  }}
                  label={t('labelImage')}
                />
              ) : (
                <p className="text-xs text-gray-400">{t('imageAfterCreate')}</p>
              )}
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
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_popular} onChange={(e) => setForm(f => ({ ...f, is_popular: e.target.checked }))} className="w-4 h-4 accent-[#6B1F3A]" />
                <span className="text-sm text-gray-700">{t('markPopular')}</span>
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
              {sub.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={sub.image_url} alt="" className="w-full aspect-video object-cover" />
              )}
              <div className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{sub.name_en}</p>
                    {sub.language && <span className="text-sm shrink-0" title={LANGUAGES.find(l => l.value === sub.language)?.label}>{LANG_FLAG[sub.language] ?? ''}</span>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {sub.is_popular && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">Popular</span>}
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
                  <button onClick={() => openDuplicate(sub)} className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 transition">{t('duplicate')}</button>
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
