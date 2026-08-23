'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import ColorPicker from '@/components/ui/ColorPicker'
import ImageUploadInput from '@/components/ui/ImageUploadInput'
import { apiFetch, ApiError } from '@/lib/api/client'

// Gestione pacchetti condivisa tra pannello Scuola (/api/school/packages) e
// HQ (/api/hq/packages): stesso form, stesse card, stessi badge.

type Package = {
  id: string
  name_en: string
  name_it: string | null
  name_fr: string | null
  name_es: string | null
  description_en: string | null
  description_it: string | null
  description_fr: string | null
  description_es: string | null
  credits: number
  validity_days: number
  validity_unit: string | null
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
  allowed_lesson_types: string[] | null
  mode_filter: string | null
  is_unlimited: boolean
  weekly_booking_cap: number | null
}

type LessonTypeOption = {
  id: string
  code: string
  name_it: string | null
  name_en: string | null
  name_fr: string | null
  name_es: string | null
}

type CourseCost = { lesson_type: string | null; credit_cost: number | null }

// Un pacchetto, quattro lingue: il selettore serve solo a scegliere quale
// traduzione stai modificando (niente più duplicati per lingua).
const EDIT_LANGS = ['it', 'en', 'fr', 'es'] as const
type EditLang = (typeof EDIT_LANGS)[number]

const LANG_FLAG: Record<string, string> = { it: '🇮🇹', en: '🇬🇧', fr: '🇫🇷', es: '🇪🇸' }

const emptyForm = {
  names: { it: '', en: '', fr: '', es: '' } as Record<EditLang, string>,
  descriptions: { it: '', en: '', fr: '', es: '' } as Record<EditLang, string>,
  credits: '10', validity_days: '90', validity_unit: 'days', price: '',
  color: '#6B1F3A', is_popular: false, is_vip: false,
  is_recurring: false, recurring_interval: 'month', credits_rollover: false,
  allowed_lesson_types: [] as string[], mode_filter: 'all',
  is_unlimited: false, weekly_booking_cap: '',
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
  const locale = useLocale()
  const [packages, setPackages] = useState<Package[]>([])
  // Tab Attivi / Disattivati (per Carlo): i disattivati non affollano la vista
  const [statusTab, setStatusTab] = useState<'active' | 'inactive'>('active')
  const visiblePackages = packages.filter(p => statusTab === 'active' ? p.active : !p.active)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Package | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [editLang, setEditLang] = useState<EditLang>('it')
  const [translating, setTranslating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lessonTypes, setLessonTypes] = useState<LessonTypeOption[]>([])
  const [courseCosts, setCourseCosts] = useState<CourseCost[]>([])

  // "/school/packages" → "/school" (stesso prefisso per lesson-types e courses)
  const panelBase = apiBase.replace(/\/packages$/, '')

  // Periodo di validità: con unità "months" sono mesi di calendario veri
  // (15/09 + 3 mesi → valido fino al 14/12); con "days" giorni esatti.
  function validityLabel(value: number, unit?: string | null) {
    if (unit === 'months') {
      if (value > 0 && value % 12 === 0) return t('durationYears', { count: value / 12 })
      return t('durationMonths', { count: value })
    }
    if (value > 0 && value % 365 === 0) return t('durationYears', { count: value / 365 })
    return t('durationDays', { count: value })
  }

  function typeName(lt: LessonTypeOption) {
    const byLocale: Record<string, string | null> = {
      it: lt.name_it, en: lt.name_en, fr: lt.name_fr, es: lt.name_es,
    }
    return byLocale[locale] || lt.name_en || lt.name_it || lt.code
  }

  // Helper ingressi × costo (PACKAGE_TO_SUBSCRIPTION.md §3.2): con i tipi
  // selezionati, guarda i costi-credito dei corsi corrispondenti. Un solo
  // costo → mostra "N crediti = M ingressi"; costi diversi → avviso.
  const costInfo = useMemo(() => {
    const selected = new Set(form.allowed_lesson_types)
    const relevant = courseCosts.filter(c =>
      c.credit_cost != null && c.lesson_type != null &&
      (selected.size === 0 || selected.has(String(c.lesson_type)))
    )
    const costs = [...new Set(relevant.map(c => Number(c.credit_cost)))]
    return { costs, mixed: costs.length > 1, single: costs.length === 1 ? costs[0] : null }
  }, [form.allowed_lesson_types, courseCosts])

  const intervalOptions = [
    { value: 'week', label: t('intervalWeekly') },
    { value: 'month', label: t('intervalMonthly') },
    { value: '3month', label: t('interval3Months') },
    { value: '6month', label: t('interval6Months') },
    { value: 'year', label: t('intervalYearly') },
  ]

  async function load() {
    setLoading(true)
    try {
      setPackages(await apiFetch<Package[]>(`${apiBase}/`))
    } catch {
      setPackages([])
    }
    setLoading(false)
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    apiFetch<LessonTypeOption[]>(`${panelBase}/lesson-types/?active=true`)
      .then(setLessonTypes).catch(() => setLessonTypes([]))
    apiFetch<CourseCost[]>(`${panelBase}/courses/?active=true`)
      .then(cs => setCourseCosts((cs ?? []).map(c => ({ lesson_type: c.lesson_type, credit_cost: c.credit_cost }))))
      .catch(() => setCourseCosts([]))
  }, [panelBase])

  // Nome/descrizione del pacchetto nella lingua dell'utente, con fallback
  function pkgName(pkg: Package) {
    const by: Record<string, string | null> = {
      it: pkg.name_it, en: pkg.name_en, fr: pkg.name_fr, es: pkg.name_es,
    }
    return by[locale] || pkg.name_en || pkg.name_it || pkg.name_fr || pkg.name_es || ''
  }

  function pkgDescription(pkg: Package) {
    const by: Record<string, string | null> = {
      it: pkg.description_it, en: pkg.description_en, fr: pkg.description_fr, es: pkg.description_es,
    }
    return by[locale] || pkg.description_en || pkg.description_it || ''
  }

  function formFrom(pkg: Package) {
    return {
      names: {
        it: pkg.name_it ?? '', en: pkg.name_en ?? '',
        fr: pkg.name_fr ?? '', es: pkg.name_es ?? '',
      },
      descriptions: {
        it: pkg.description_it ?? '', en: pkg.description_en ?? '',
        fr: pkg.description_fr ?? '', es: pkg.description_es ?? '',
      },
      credits: String(pkg.credits),
      validity_days: String(pkg.validity_days),
      validity_unit: pkg.validity_unit ?? 'days',
      price: String(pkg.price),
      color: pkg.color,
      is_popular: pkg.is_popular,
      is_vip: pkg.is_vip ?? false,
      is_recurring: pkg.is_recurring ?? false,
      recurring_interval: pkg.recurring_interval ?? 'month',
      credits_rollover: pkg.credits_rollover ?? false,
      allowed_lesson_types: (pkg.allowed_lesson_types ?? []).map(String),
      mode_filter: pkg.mode_filter ?? 'all',
      is_unlimited: pkg.is_unlimited ?? false,
      weekly_booking_cap: pkg.weekly_booking_cap != null ? String(pkg.weekly_booking_cap) : '',
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
    const anyName = EDIT_LANGS.some(l => form.names[l].trim())
    if (!anyName || !form.credits || !form.validity_days || !form.price) {
      setError('Name, credits, validity and price are required.')
      return
    }
    setSaving(true)
    setError(null)
    const method = editing ? 'PATCH' : 'POST'
    const url = editing ? `${apiBase}/${editing.id}/` : `${apiBase}/`
    const { names, descriptions, weekly_booking_cap, ...rest } = form
    try {
      await apiFetch(url, {
        method,
        body: JSON.stringify({
          ...rest,
          name_it: names.it, name_en: names.en, name_fr: names.fr, name_es: names.es,
          description_it: descriptions.it, description_en: descriptions.en,
          description_fr: descriptions.fr, description_es: descriptions.es,
          weekly_booking_cap: weekly_booking_cap === '' ? null : Number(weekly_booking_cap),
        }),
      })
      setShowForm(false)
      load()
    } catch (err) {
      const errCode = err instanceof ApiError && typeof err.body === 'object' && err.body
        ? (err.body as { error?: string }).error : undefined
      setError(errCode ?? 'Something went wrong')
    }
    setSaving(false)
  }

  // Traduzione AI: riempie le lingue mancanti a partire da quella corrente
  async function handleAutoTranslate() {
    if (!editing) return
    setTranslating(true)
    setError(null)
    try {
      const updated = await apiFetch<Package>(`${apiBase}/${editing.id}/auto-translate/`, {
        method: 'POST',
        body: JSON.stringify({ source: editLang }),
      })
      setForm(f => ({ ...f, ...formFrom(updated) }))
      setPackages(prev => prev.map(p => p.id === updated.id ? updated : p))
    } catch (err) {
      const errCode = err instanceof ApiError && typeof err.body === 'object' && err.body
        ? (err.body as { error?: string }).error : undefined
      setError(errCode ?? 'Translation failed')
    }
    setTranslating(false)
  }

  async function handleToggle(pkg: Package) {
    await apiFetch(`${apiBase}/${pkg.id}/`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !pkg.active }),
    }).catch(() => {})
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
            {/* Traduzioni: un pacchetto, 4 lingue — le chip scelgono quale stai modificando */}
            <div className="col-span-2">
              <div className="flex items-center justify-between mb-2">
                <div className="flex gap-1.5">
                  {EDIT_LANGS.map(l => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => setEditLang(l)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${editLang === l ? 'bg-[#6B1F3A] text-white border-[#6B1F3A]' : form.names[l].trim() ? 'bg-white text-gray-700 border-gray-300' : 'bg-white text-gray-400 border-dashed border-gray-200'}`}
                      title={form.names[l].trim() ? undefined : t('translationEmpty')}
                    >
                      {LANG_FLAG[l]} {l.toUpperCase()}
                    </button>
                  ))}
                </div>
                {editing && (
                  <button
                    type="button"
                    onClick={handleAutoTranslate}
                    disabled={translating || !form.names[editLang].trim()}
                    className="text-xs text-[#6B1F3A] font-medium hover:underline disabled:opacity-40 disabled:no-underline"
                  >
                    {translating ? t('translating') : t('autoTranslate')}
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-400 mb-3">{t('translationsHint')}</p>
            </div>
            <div>
              <label className={labelCls}>{t('labelName')} — {LANG_FLAG[editLang]} {editLang.toUpperCase()}</label>
              <input
                value={form.names[editLang]}
                onChange={(e) => setForm(f => ({ ...f, names: { ...f.names, [editLang]: e.target.value } }))}
                className={inputCls}
                placeholder="e.g. Starter Pack"
              />
            </div>
            <div>
              <label className={labelCls}>{t('labelDescription')} — {LANG_FLAG[editLang]} {editLang.toUpperCase()}</label>
              <input
                value={form.descriptions[editLang]}
                onChange={(e) => setForm(f => ({ ...f, descriptions: { ...f.descriptions, [editLang]: e.target.value } }))}
                className={inputCls}
                placeholder="Short description..."
              />
            </div>
            <div>
              <label className={labelCls}>{t('labelCredits')}</label>
              <input type="number" min="0.5" step="0.5" value={form.credits} onChange={(e) => setForm(f => ({ ...f, credits: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t('labelValidityDays')}</label>
              <div className="flex gap-2">
                <input type="number" min="1" value={form.validity_days} onChange={(e) => setForm(f => ({ ...f, validity_days: e.target.value }))} className={inputCls} />
                <select value={form.validity_unit} onChange={(e) => setForm(f => ({ ...f, validity_unit: e.target.value }))} className={inputCls}>
                  <option value="days">{t('validityUnitDays')}</option>
                  <option value="months">{t('validityUnitMonths')}</option>
                </select>
              </div>
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
                  endpoint={`${apiBase}/${editing.id}/image/`}
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

            {/* Restrizioni di prenotazione (PACKAGE_TO_SUBSCRIPTION.md §3.1b-3.3) */}
            <div className="col-span-2 border-t border-gray-100 pt-4 mt-1">
              <p className="text-sm font-semibold text-gray-800 mb-3">{t('restrictionsSection')}</p>
              <div className="mb-3">
                <label className={labelCls}>{t('labelAllowedTypes')}</label>
                <div className="flex flex-wrap gap-2">
                  {lessonTypes.map(lt => {
                    const selected = form.allowed_lesson_types.includes(String(lt.id))
                    return (
                      <button
                        key={lt.id}
                        type="button"
                        onClick={() => setForm(f => ({
                          ...f,
                          allowed_lesson_types: selected
                            ? f.allowed_lesson_types.filter(id => id !== String(lt.id))
                            : [...f.allowed_lesson_types, String(lt.id)],
                        }))}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${selected ? 'bg-[#6B1F3A] text-white border-[#6B1F3A]' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
                      >
                        {typeName(lt)}
                      </button>
                    )
                  })}
                </div>
                <p className="text-xs text-gray-400 mt-1">{t('allowedTypesHint')}</p>
                {costInfo.mixed && (
                  <p className="text-xs text-amber-600 mt-1">{t('mixedCostWarning')}</p>
                )}
                {!costInfo.mixed && costInfo.single != null && Number(form.credits) > 0 && (
                  <p className="text-xs text-gray-500 mt-1">
                    {t('entriesHelper', {
                      credits: form.credits,
                      entries: Math.floor(Number(form.credits) / costInfo.single),
                      cost: costInfo.single,
                    })}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>{t('labelModeFilter')}</label>
                  <select value={form.mode_filter} onChange={(e) => setForm(f => ({ ...f, mode_filter: e.target.value }))} className={inputCls}>
                    <option value="all">{t('modeAll')}</option>
                    <option value="online">{t('modeOnline')}</option>
                    <option value="in_person">{t('modeInPerson')}</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>{t('labelWeeklyCap')}</label>
                  <input type="number" min="1" value={form.weekly_booking_cap} onChange={(e) => setForm(f => ({ ...f, weekly_booking_cap: e.target.value }))} className={inputCls} placeholder="—" />
                  <p className="text-xs text-gray-400 mt-1">{t('weeklyCapHint')}</p>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer mt-3">
                <input type="checkbox" checked={form.is_unlimited} onChange={(e) => setForm(f => ({ ...f, is_unlimited: e.target.checked }))} className="w-4 h-4 accent-[#6B1F3A]" />
                <span className="text-sm text-gray-700">{t('unlimitedToggle')}</span>
              </label>
            </div>

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

      <div className="mb-4 inline-flex bg-gray-100 rounded-lg p-1 gap-0.5">
        {(['active', 'inactive'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setStatusTab(tab)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${
              statusTab === tab ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'active' ? t('tabActive') : t('tabInactive')}
            <span className="ml-1.5 text-xs text-gray-400">
              {packages.filter(p => tab === 'active' ? p.active : !p.active).length}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-gray-400">{t('loading')}</div>
      ) : visiblePackages.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
          <p className="text-gray-400 text-sm">{t('noPackages')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visiblePackages.map((pkg) => (
            <div key={pkg.id} className={`bg-white rounded-xl border border-gray-100 overflow-hidden ${!pkg.active ? 'opacity-50' : ''}`}>
              <div className="h-2" style={{ backgroundColor: pkg.color }} />
              {pkg.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={pkg.image_url} alt="" className="w-full aspect-video object-cover" />
              )}
              <div className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{pkgName(pkg)}</p>
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
                        ↻ {t('badgeSubscription')} · {intervalOptions.find(o => o.value === pkg.recurring_interval)?.label ?? pkg.recurring_interval}
                      </span>
                    )}
                  </div>
                </div>
                {pkgDescription(pkg) && <p className="text-xs text-gray-500 mb-3">{pkgDescription(pkg)}</p>}
                <div className="grid grid-cols-4 gap-3 text-xs mb-4">
                  <div>
                    <p className="text-red-600 font-semibold">{t('colCredits')}</p>
                    <p className="font-bold text-gray-900 mt-0.5">{pkg.is_unlimited ? t('badgeUnlimited') : pkg.credits}</p>
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
                    <p className="font-bold text-gray-900 mt-0.5">{pkg.is_recurring ? (intervalOptions.find(o => o.value === pkg.recurring_interval)?.label ?? '–') : validityLabel(pkg.validity_days, pkg.validity_unit)}</p>
                  </div>
                </div>
                {pkg.is_recurring && pkg.credits_rollover && (
                  <p className="text-xs text-blue-500 mb-3">{t('rolloverBadge')}</p>
                )}
                {((pkg.allowed_lesson_types ?? []).length > 0 || (pkg.mode_filter && pkg.mode_filter !== 'all') || pkg.weekly_booking_cap != null) && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {(pkg.allowed_lesson_types ?? []).map(id => {
                      const lt = lessonTypes.find(l => String(l.id) === String(id))
                      return lt ? (
                        <span key={id} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{typeName(lt)}</span>
                      ) : null
                    })}
                    {pkg.mode_filter === 'online' && <span className="text-xs bg-sky-50 text-sky-600 px-2 py-0.5 rounded-full">{t('modeOnline')}</span>}
                    {pkg.mode_filter === 'in_person' && <span className="text-xs bg-sky-50 text-sky-600 px-2 py-0.5 rounded-full">{t('modeInPerson')}</span>}
                    {pkg.weekly_booking_cap != null && (
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{t('capBadge', { cap: pkg.weekly_booking_cap })}</span>
                    )}
                  </div>
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
