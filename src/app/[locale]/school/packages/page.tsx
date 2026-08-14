'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

type Package = {
  id: string
  name_en: string
  name_it: string | null
  description_en: string | null
  credits: number
  validity_days: number
  price: number
  color: string
  is_popular: boolean
  active: boolean
  is_recurring: boolean
  recurring_interval: string | null
  credits_rollover: boolean
  lesson_types: { name_en: string } | null
}

const COLORS = ['#6B1F3A', '#1F3A6B', '#1F6B3A', '#6B5A1F', '#3A1F6B', '#4A4A4A']

const INTERVAL_OPTIONS = [
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
  { value: '3month', label: 'Every 3 months' },
  { value: 'year', label: 'Yearly' },
]

const emptyForm = {
  name_en: '', name_it: '', description_en: '',
  credits: '10', validity_days: '90', price: '',
  color: '#6B1F3A', is_popular: false,
  is_recurring: false, recurring_interval: 'month', credits_rollover: false,
}

export default function SchoolPackagesPage() {
  const t = useTranslations('school.packages')
  const [packages, setPackages] = useState<Package[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Package | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const res = await fetch('/api/school/packages', { cache: 'no-store' })
    if (res.ok) setPackages(await res.json())
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setError(null)
    setShowForm(true)
  }

  function openEdit(pkg: Package) {
    setEditing(pkg)
    setForm({
      name_en: pkg.name_en,
      name_it: pkg.name_it ?? '',
      description_en: pkg.description_en ?? '',
      credits: String(pkg.credits),
      validity_days: String(pkg.validity_days),
      price: String(pkg.price),
      color: pkg.color,
      is_popular: pkg.is_popular,
      is_recurring: pkg.is_recurring ?? false,
      recurring_interval: pkg.recurring_interval ?? 'month',
      credits_rollover: pkg.credits_rollover ?? false,
    })
    setError(null)
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.name_en || !form.credits || !form.validity_days || !form.price) {
      setError('Name, credits, validity and price are required.')
      return
    }
    setSaving(true)
    setError(null)
    const method = editing ? 'PATCH' : 'POST'
    const url = editing ? `/api/school/packages/${editing.id}` : '/api/school/packages'
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
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

  async function handleToggle(pkg: Package) {
    await fetch(`/api/school/packages/${pkg.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !pkg.active }),
    })
    load()
  }

  const inputCls = 'w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
          <p className="text-gray-500 text-sm mt-0.5">{t('subtitle')}</p>
        </div>
        <button onClick={openCreate} className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition">
          {t('newPackage')}
        </button>
      </div>

      {showForm && (
        <div className="mb-6 bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">{editing ? t('editPackage') : t('newPackage')}</h2>
          {error && <div className="mb-3 p-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>{t('labelNameEn')}</label>
                <input value={form.name_en} onChange={(e) => setForm(f => ({ ...f, name_en: e.target.value }))} className={inputCls} placeholder="e.g. Starter Pack" />
              </div>
              <div>
                <label className={labelCls}>{t('labelNameIt')}</label>
                <input value={form.name_it} onChange={(e) => setForm(f => ({ ...f, name_it: e.target.value }))} className={inputCls} placeholder="e.g. Pacchetto Base" />
              </div>
            </div>
            <div className="col-span-2">
              <label className={labelCls}>{t('labelDescription')}</label>
              <input value={form.description_en} onChange={(e) => setForm(f => ({ ...f, description_en: e.target.value }))} className={inputCls} placeholder="Short description..." />
            </div>
            <div>
              <label className={labelCls}>{t('labelCredits')}</label>
              <input type="number" min="1" value={form.credits} onChange={(e) => setForm(f => ({ ...f, credits: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t('labelValidityDays')}</label>
              <input type="number" min="1" value={form.validity_days} onChange={(e) => setForm(f => ({ ...f, validity_days: e.target.value }))} className={inputCls} />
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

            {/* Recurring toggle */}
            <div className="col-span-2 border-t border-gray-100 pt-4 mt-1">
              <label className="flex items-center gap-3 cursor-pointer">
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, is_recurring: !f.is_recurring }))}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.is_recurring ? 'bg-[#6B1F3A]' : 'bg-gray-200'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${form.is_recurring ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
                <span className="text-sm font-medium text-gray-700">Recurring package (auto-renews)</span>
              </label>
            </div>

            {form.is_recurring && (
              <>
                <div>
                  <label className={labelCls}>Renewal interval</label>
                  <select value={form.recurring_interval} onChange={(e) => setForm(f => ({ ...f, recurring_interval: e.target.value }))} className={inputCls}>
                    {INTERVAL_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center">
                  <label className="flex items-center gap-2 cursor-pointer mt-4">
                    <input type="checkbox" checked={form.credits_rollover} onChange={(e) => setForm(f => ({ ...f, credits_rollover: e.target.checked }))} className="w-4 h-4 accent-[#6B1F3A]" />
                    <span className="text-sm text-gray-700">Roll over unused credits on renewal</span>
                  </label>
                </div>
              </>
            )}

            <div className="flex items-center gap-3 mt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_popular} onChange={(e) => setForm(f => ({ ...f, is_popular: e.target.checked }))} className="w-4 h-4 accent-[#6B1F3A]" />
                <span className="text-sm text-gray-700">{t('markPopular')}</span>
              </label>
            </div>
          </div>
          <div className="flex gap-3 mt-5">
            <button onClick={handleSave} disabled={saving} className="px-5 py-2 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] disabled:opacity-50 transition">
              {saving ? t('saving') : (editing ? t('saveChanges') : t('createPackage'))}
            </button>
            <button onClick={() => setShowForm(false)} className="px-5 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition">
              {t('cancel')}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-400">{t('loading')}</div>
      ) : packages.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
          <p className="text-gray-400 text-sm">{t('noPackages')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {packages.map((pkg) => (
            <div key={pkg.id} className={`bg-white rounded-xl border border-gray-100 overflow-hidden ${!pkg.active ? 'opacity-50' : ''}`}>
              <div className="h-2" style={{ backgroundColor: pkg.color }} />
              <div className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-semibold text-gray-900">{pkg.name_en}</p>
                    {pkg.name_it && <p className="text-xs text-gray-400">{pkg.name_it}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {pkg.is_popular && (
                      <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">Popular</span>
                    )}
                    {pkg.is_recurring && (
                      <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">
                        ↻ {INTERVAL_OPTIONS.find(o => o.value === pkg.recurring_interval)?.label ?? pkg.recurring_interval}
                      </span>
                    )}
                  </div>
                </div>
                {pkg.description_en && <p className="text-xs text-gray-500 mb-3">{pkg.description_en}</p>}
                <div className="grid grid-cols-4 gap-3 text-xs mb-4">
                  <div>
                    <p className="text-red-600 font-semibold">{t('colCredits')}</p>
                    <p className="font-bold text-gray-900 mt-0.5">{pkg.credits}</p>
                  </div>
                  <div>
                    <p className="text-red-600 font-semibold">{t('colTotalPrice')}</p>
                    <p className="font-bold text-gray-900 mt-0.5">€{Number(pkg.price).toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-red-600 font-semibold">{t('colPricePerCredit')}</p>
                    <p className="font-bold text-gray-900 mt-0.5">€{(Number(pkg.price) / Number(pkg.credits)).toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-red-600 font-semibold">{pkg.is_recurring ? 'Interval' : t('colValidFor')}</p>
                    <p className="font-bold text-gray-900 mt-0.5">{pkg.is_recurring ? (INTERVAL_OPTIONS.find(o => o.value === pkg.recurring_interval)?.label?.split(' ')[0] ?? '–') : `${pkg.validity_days}d`}</p>
                  </div>
                </div>
                {pkg.is_recurring && pkg.credits_rollover && (
                  <p className="text-xs text-blue-500 mb-3">Credits roll over on renewal</p>
                )}
                <div className="flex gap-2">
                  <button onClick={() => openEdit(pkg)} className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 transition">{t('edit')}</button>
                  <button onClick={() => handleToggle(pkg)} className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 transition">
                    {pkg.active ? t('deactivate') : t('activate')}
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
