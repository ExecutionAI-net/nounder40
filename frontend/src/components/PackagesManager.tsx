'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import ColorPicker from '@/components/ui/ColorPicker'
import ImageUploadInput from '@/components/ui/ImageUploadInput'

// Gestione pacchetti condivisa tra pannello Scuola (/api/school/packages) e
// HQ (/api/hq/packages): stesso form, stesse card, stessi badge.

type Package = {
  id: string
  name_en: string
  name_it: string | null
  description_en: string | null
  credits: number
  validity_days: number
  price: number
  color: string
  language: string | null
  image_url: string | null
  is_popular: boolean
  is_vip: boolean
  active: boolean
  is_recurring: boolean
  recurring_interval: string | null
  credits_rollover: boolean
}

const LANGUAGES = [
  { value: 'it', label: 'Italiano' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
]

const LANG_FLAG: Record<string, string> = { it: '🇮🇹', en: '🇬🇧', es: '🇪🇸' }

const emptyForm = {
  name: '', description_en: '', language: 'it',
  credits: '10', validity_days: '90', price: '',
  color: '#6B1F3A', is_popular: false, is_vip: false,
  is_recurring: false, recurring_interval: 'month', credits_rollover: false,
}

export default function PackagesManager({
  apiBase,
  title,
  subtitle,
}: {
  apiBase: string
  title: string
  subtitle: string
}) {
  const t = useTranslations('school.packages')
  const [packages, setPackages] = useState<Package[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Package | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const intervalOptions = [
    { value: 'week', label: t('intervalWeekly') },
    { value: 'month', label: t('intervalMonthly') },
    { value: '3month', label: t('interval3Months') },
    { value: 'year', label: t('intervalYearly') },
  ]

  async function load() {
    setLoading(true)
    const res = await fetch(apiBase, { cache: 'no-store' })
    if (res.ok) setPackages(await res.json())
    setLoading(false)
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function formFrom(pkg: Package) {
    return {
      name: pkg.name_en,
      description_en: pkg.description_en ?? '',
      language: pkg.language ?? 'it',
      credits: String(pkg.credits),
      validity_days: String(pkg.validity_days),
      price: String(pkg.price),
      color: pkg.color,
      is_popular: pkg.is_popular,
      is_vip: pkg.is_vip ?? false,
      is_recurring: pkg.is_recurring ?? false,
      recurring_interval: pkg.recurring_interval ?? 'month',
      credits_rollover: pkg.credits_rollover ?? false,
    }
  }

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setError(null)
    setShowForm(true)
  }

  function openEdit(pkg: Package) {
    setEditing(pkg)
    setForm(formFrom(pkg))
    setError(null)
    setShowForm(true)
  }

  // Duplica: form precompilato come nuovo pacchetto (per la versione in un'altra lingua)
  function openDuplicate(pkg: Package) {
    setEditing(null)
    setForm(formFrom(pkg))
    setError(null)
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleSave() {
    if (!form.name || !form.credits || !form.validity_days || !form.price) {
      setError('Name, credits, validity and price are required.')
      return
    }
    setSaving(true)
    setError(null)
    const method = editing ? 'PATCH' : 'POST'
    const url = editing ? `${apiBase}/${editing.id}` : apiBase
    const { name, ...rest } = form
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...rest, name_en: name, name_it: name }),
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
    await fetch(`${apiBase}/${pkg.id}`, {
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
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          <p className="text-gray-500 text-sm mt-0.5">{subtitle}</p>
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
            <div>
              <label className={labelCls}>{t('labelName')}</label>
              <input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} className={inputCls} placeholder="e.g. Starter Pack" />
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
              <ColorPicker value={form.color} onChange={(c) => setForm(f => ({ ...f, color: c }))} />
            </div>

            {/* Foto pacchetto: upload disponibile dopo il salvataggio */}
            <div className="col-span-2">
              {editing ? (
                <ImageUploadInput
                  endpoint={`${apiBase}/${editing.id}/image`}
                  imageUrl={editing.image_url}
                  onChange={(url) => {
                    setEditing(p => p ? { ...p, image_url: url } : p)
                    setPackages(prev => prev.map(p => p.id === editing.id ? { ...p, image_url: url } : p))
                  }}
                  label={t('labelImage')}
                />
              ) : (
                <p className="text-xs text-gray-400">{t('imageAfterCreate')}</p>
              )}
            </div>

            {/* Ricorrenza — allineato con gli abbonamenti */}
            <div className="col-span-2 border-t border-gray-100 pt-4 mt-1">
              <label className="flex items-center gap-3 cursor-pointer">
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, is_recurring: !f.is_recurring }))}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.is_recurring ? 'bg-[#6B1F3A]' : 'bg-gray-200'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${form.is_recurring ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
                <span className="text-sm font-medium text-gray-700">{t('recurringToggle')}</span>
              </label>
            </div>

            {form.is_recurring && (
              <>
                <div>
                  <label className={labelCls}>{t('renewalInterval')}</label>
                  <select value={form.recurring_interval} onChange={(e) => setForm(f => ({ ...f, recurring_interval: e.target.value }))} className={inputCls}>
                    {intervalOptions.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center">
                  <label className="flex items-center gap-2 cursor-pointer mt-4">
                    <input type="checkbox" checked={form.credits_rollover} onChange={(e) => setForm(f => ({ ...f, credits_rollover: e.target.checked }))} className="w-4 h-4 accent-[#6B1F3A]" />
                    <span className="text-sm text-gray-700">{t('rolloverToggle')}</span>
                  </label>
                </div>
              </>
            )}

            {/* Popolare + VIP — allineato con gli abbonamenti */}
            <div className="col-span-2 flex gap-6 mt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_popular} onChange={(e) => setForm(f => ({ ...f, is_popular: e.target.checked }))} className="w-4 h-4 accent-[#6B1F3A]" />
                <span className="text-sm text-gray-700">{t('markPopular')}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_vip} onChange={(e) => setForm(f => ({ ...f, is_vip: e.target.checked }))} className="w-4 h-4 accent-[#6B1F3A]" />
                <span className="text-sm text-gray-700">{t('vip')}</span>
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
              {pkg.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={pkg.image_url} alt="" className="w-full aspect-video object-cover" />
              )}
              <div className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{pkg.name_en}</p>
                    {pkg.language && <span className="text-sm shrink-0" title={LANGUAGES.find(l => l.value === pkg.language)?.label}>{LANG_FLAG[pkg.language] ?? ''}</span>}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {pkg.is_popular && (
                      <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">Popular</span>
                    )}
                    {pkg.is_vip && (
                      <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">VIP</span>
                    )}
                    {pkg.is_recurring && (
                      <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">
                        ↻ {intervalOptions.find(o => o.value === pkg.recurring_interval)?.label ?? pkg.recurring_interval}
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
                    <p className="text-red-600 font-semibold">{pkg.is_recurring ? t('colInterval') : t('colValidFor')}</p>
                    <p className="font-bold text-gray-900 mt-0.5">{pkg.is_recurring ? (intervalOptions.find(o => o.value === pkg.recurring_interval)?.label ?? '–') : `${pkg.validity_days}d`}</p>
                  </div>
                </div>
                {pkg.is_recurring && pkg.credits_rollover && (
                  <p className="text-xs text-blue-500 mb-3">{t('rolloverBadge')}</p>
                )}
                <div className="flex gap-2">
                  <button onClick={() => openEdit(pkg)} className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 transition">{t('edit')}</button>
                  <button onClick={() => openDuplicate(pkg)} className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 transition">{t('duplicate')}</button>
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
