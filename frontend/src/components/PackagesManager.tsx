'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import ColorPicker from '@/components/ui/ColorPicker'
import ImageUploadInput from '@/components/ui/ImageUploadInput'
import { apiFetch, ApiError } from '@/lib/api/client'
import { formatCredits } from '@/lib/credits'
import { localizedName } from '@/lib/localized-name'

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
  is_drop_in: boolean
  // Calcolati dal backend: null se i tipi coperti costano crediti diversi
  // (allora un "numero di lezioni" non esiste) o per i pacchetti HQ
  lesson_credit_cost: string | null
  lessons_included: number | null
  price_per_lesson: string | null
  weekly_booking_cap: number | null
  has_purchases: boolean
}

type LessonTypeOption = {
  id: string
  code: string
  name_it: string | null
  name_en: string | null
  name_fr: string | null
  name_es: string | null
}

type CourseCost = { lesson_type: string | null; credit_cost: number | null; is_online: boolean | null }

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
  is_unlimited: false, is_drop_in: false, weekly_booking_cap: '',
  image_url: '',
}

export default function PackagesManager({
  apiBase,
  title,
  subtitle,
  // Il prezzo lezione singola e' una cosa della scuola: la risoluzione cerca
  // fra i pacchetti DELLA scuola della lezione, quindi su un pacchetto HQ
  // (school = null) il flag non potrebbe mai attivarsi. Meglio non mostrarlo
  // che mostrare un interruttore che non fa niente.
  allowDropIn = true,
}: {
  apiBase: string
  allowDropIn?: boolean
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
  // Il banner d'errore sta in cima a un form lungo: chi preme "Salva" da giu'
  // (accanto alla foto) non lo vede e crede che il salvataggio sia andato, o
  // che sia rotto qualcos'altro. Lo portiamo sotto gli occhi.
  const errorRef = useRef<HTMLDivElement>(null)
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
    // Nessun tipo ancora scelto: niente da confrontare, niente avvisi (la
    // selezione e' comunque obbligatoria al salvataggio).
    if (selected.size === 0) return { costs: [] as number[], mixed: false, single: null }
    const relevant = courseCosts.filter(c =>
      c.credit_cost != null && c.lesson_type != null &&
      selected.has(String(c.lesson_type)) &&
      // Il confronto rispetta la modalita' del pacchetto: un "solo online"
      // non deve suonare l'allarme per i costi dei corsi in presenza.
      (form.mode_filter === 'online' ? c.is_online === true
        : form.mode_filter === 'in_person' ? c.is_online === false
        : true)
    )
    const costs = [...new Set(relevant.map(c => Number(c.credit_cost)))]
    return { costs, mixed: costs.length > 1, single: costs.length === 1 ? costs[0] : null }
  }, [form.allowed_lesson_types, form.mode_filter, courseCosts])

  // Un drop-in E' una lezione: i suoi crediti sono il costo della lezione, non
  // un numero da indovinare (era la trappola: 20 crediti a 19,97 lasciavano 19
  // crediti spaiati). Quando i tipi scelti hanno costi diversi non si puo'
  // derivare nulla — resta modificabile e si avvisa.
  const dropInCreditsLocked = form.is_drop_in && !costInfo.mixed && costInfo.single != null

  useEffect(() => {
    if (!dropInCreditsLocked) return
    const cost = String(costInfo.single)
    setForm(f => (f.credits === cost ? f : { ...f, credits: cost }))
  }, [dropInCreditsLocked, costInfo.single])

  // Rinnovo, illimitato e tetto settimanale sono nascosti sul drop-in: qui si
  // azzerano davvero, cosi' non restano appiccicati riaprendo un pacchetto.
  useEffect(() => {
    if (!form.is_drop_in) return
    setForm(f => (
      f.is_recurring || f.is_unlimited || f.weekly_booking_cap !== ''
        ? { ...f, is_recurring: false, is_unlimited: false, weekly_booking_cap: '' }
        : f
    ))
  }, [form.is_drop_in])

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [error])

  const intervalOptions = [
    { value: 'week', label: t('intervalWeekly') },
    { value: 'month', label: t('intervalMonthly') },
    { value: '3month', label: t('interval3Months') },
    { value: '6month', label: t('interval6Months') },
    { value: 'year', label: t('intervalYearly') },
  ]

  // Ordine dei pacchetti: si sposta subito, si salva ~2s dopo l'ULTIMO click
  // (stesso comportamento del riordino corsi: niente una chiamata per freccia).
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingIds = useRef<string[] | null>(null)

  const persistOrder = useCallback(async (ids: string[]) => {
    pendingIds.current = null
    try {
      await apiFetch(`${apiBase}/reorder/`, { method: 'POST', body: JSON.stringify({ ids }) })
    } catch {
      setError(t('reorderFailed'))
    }
  }, [apiBase, t])

  // Se si lascia la pagina con un salvataggio in sospeso, si salva subito
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    if (pendingIds.current) void persistOrder(pendingIds.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function movePackage(id: string, dir: -1 | 1) {
    // Si riordina dentro la scheda che si sta guardando (Attivi o
    // Disattivati), ma si salva l'elenco intero: mandare solo i visibili
    // riscriverebbe le posizioni degli altri.
    const list = visiblePackages
    const idx = list.findIndex(p => p.id === id)
    const target = idx + dir
    if (idx < 0 || target < 0 || target >= list.length) return

    const reordered = [...list]
    ;[reordered[idx], reordered[target]] = [reordered[target], reordered[idx]]
    let k = 0
    const next = packages.map(p => (list.some(v => v.id === p.id) ? reordered[k++] : p))
    setPackages(next)

    const ids = next.map(p => p.id)
    pendingIds.current = ids
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => persistOrder(ids), 2000)
  }

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
      .then(cs => setCourseCosts((cs ?? []).map(c => ({ lesson_type: c.lesson_type, credit_cost: c.credit_cost, is_online: c.is_online }))))
      .catch(() => setCourseCosts([]))
  }, [panelBase])

  // Nome/descrizione del pacchetto nella lingua dell'utente, con fallback
  const pkgName = (pkg: Package) => localizedName(pkg, locale)

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
      is_drop_in: pkg.is_drop_in ?? false,
      image_url: pkg.image_url ?? '',
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
  // Duplica: copia tutto (restrizioni, immagine, prezzo...), si modifica poi.
  // L'unica cosa che cambia e' il nome, cosi' i due pacchetti si distinguono
  // nell'elenco: il suffisso e' nella lingua della traduzione, non una parola
  // inglese appiccicata a tutte.
  const COPY_SUFFIX: Record<EditLang, string> = { it: 'copia', en: 'copy', fr: 'copie', es: 'copia' }

  function openDuplicate(pkg: Package) {
    const base = formFrom(pkg)
    setEditing(null)
    setForm({
      ...base,
      names: Object.fromEntries(
        EDIT_LANGS.map(l => [l, base.names[l].trim() ? `${base.names[l]} (${COPY_SUFFIX[l]})` : ''])
      ) as Record<EditLang, string>,
    })
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
    // "Nessuna selezione = tutti i tipi" sembrava comodo ma nascondeva il
    // conto: senza tipi scelti l'aiuto "N crediti a lezione" mediava corsi da
    // 1 e da 20 crediti e diceva una cosa falsa. Meglio obbligare a dichiarare
    // cosa copre il pacchetto (il backend rifiuta comunque).
    if (form.allowed_lesson_types.length === 0) {
      setError(t('allowedTypesRequired'))
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
      // DRF risponde {"campo": ["motivo"]} sugli errori di validazione, non
      // {"error": "..."} : leggendo solo `error` finiva tutto in un generico
      // "Something went wrong" che non diceva cosa correggere.
      const body = err instanceof ApiError && typeof err.body === 'object' && err.body
        ? (err.body as Record<string, unknown>) : null
      const first = body && Object.values(body).find(v => Array.isArray(v) && typeof v[0] === 'string')
      setError(
        (typeof body?.error === 'string' ? body.error : null)
        ?? (Array.isArray(first) ? String(first[0]) : null)
        ?? 'Something went wrong'
      )
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

  // Elimina: solo per pacchetti mai acquistati (il backend rifiuta gli altri,
  // che si possono soltanto disattivare — lo storico delle allieve li referenzia)
  async function handleDelete(pkg: Package) {
    if (!confirm(t('deleteConfirm', { name: pkgName(pkg) }))) return
    await apiFetch(`${apiBase}/${pkg.id}/`, { method: 'DELETE' }).catch(() => {})
    load()
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
          {error && <div ref={errorRef} className="mb-3 p-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}

          {/* In cima perche' decide com'e' fatto il resto del form: una lezione
              singola non si rinnova, non e' illimitata, non ha tetto
              settimanale, e i suoi crediti sono il costo della lezione
              (DROP_IN_BOOKING.md §4). */}
          <div className={`mb-4 p-3 rounded-xl border transition-colors ${allowDropIn ? '' : 'hidden'} ${form.is_drop_in ? 'border-teal-200 bg-teal-50/60' : 'border-gray-200 bg-gray-50/60'}`}>
            <label className="flex items-center gap-3 cursor-pointer">
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, is_drop_in: !f.is_drop_in, is_recurring: false }))}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ${form.is_drop_in ? 'bg-teal-600' : 'bg-gray-300'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${form.is_drop_in ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
              <span className="text-sm font-medium text-gray-800">{t('dropInToggle')}</span>
            </label>
            <p className="text-xs text-gray-500 mt-1.5 ml-12">{t('dropInHint')}</p>
            {form.is_drop_in && costInfo.mixed && (
              <p className="text-xs text-amber-700 mt-1.5 ml-12">{t('dropInMixedCostWarning')}</p>
            )}
          </div>

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
              <input
                type="number" min="0.5" step="0.5" value={form.credits}
                onChange={(e) => setForm(f => ({ ...f, credits: e.target.value }))}
                readOnly={dropInCreditsLocked}
                className={`${inputCls} ${dropInCreditsLocked ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : ''}`}
              />
              {dropInCreditsLocked && (
                <p className="text-xs text-gray-500 mt-1">{t('dropInCreditsLocked', { cost: costInfo.single ?? 0 })}</p>
              )}
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
                    setForm(f => ({ ...f, image_url: url ?? '' }))
                    setEditing(p => p ? { ...p, image_url: url } : p)
                    setPackages(prev => prev.map(p => p.id === editing.id ? { ...p, image_url: url } : p))
                  }}
                  label={t('labelImage')}
                />
              ) : (
                <p className="text-xs text-gray-400">{t('imageAfterCreate')}</p>
              )}
            </div>

            {/* Ricorrenza — allineato con gli abbonamenti. Su una lezione
                singola non ha senso: si paga una volta, non si abbona. */}
            <div className={`col-span-2 border-t border-gray-100 pt-4 mt-1 ${form.is_drop_in ? 'hidden' : ''}`}>
              <label className="flex items-center gap-3 cursor-pointer">
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, is_recurring: !f.is_recurring, is_drop_in: f.is_recurring ? f.is_drop_in : false }))}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.is_recurring ? 'bg-[#6B1F3A]' : 'bg-gray-200'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${form.is_recurring ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
                <span className="text-sm font-medium text-gray-700">{t('recurringToggle')}</span>
              </label>

            </div>

            {form.is_recurring && !form.is_drop_in && (
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
                <p className="text-xs text-gray-400 mt-1">{t('allowedTypesRequiredHint')}</p>
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
                {!form.is_drop_in && (
                  <div>
                    <label className={labelCls}>{t('labelWeeklyCap')}</label>
                    <input type="number" min="1" value={form.weekly_booking_cap} onChange={(e) => setForm(f => ({ ...f, weekly_booking_cap: e.target.value }))} className={inputCls} placeholder="—" />
                    <p className="text-xs text-gray-400 mt-1">{t('weeklyCapHint')}</p>
                  </div>
                )}
              </div>
              {!form.is_drop_in && (
                <label className="flex items-center gap-2 cursor-pointer mt-3">
                  <input type="checkbox" checked={form.is_unlimited} onChange={(e) => setForm(f => ({ ...f, is_unlimited: e.target.checked }))} className="w-4 h-4 accent-[#6B1F3A]" />
                  <span className="text-sm text-gray-700">{t('unlimitedToggle')}</span>
                </label>
              )}
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
                    <div className="flex flex-col shrink-0 -my-1">
                      <button
                        type="button"
                        onClick={() => movePackage(pkg.id, -1)}
                        disabled={visiblePackages.findIndex(p => p.id === pkg.id) === 0}
                        className="text-gray-300 hover:text-gray-700 disabled:opacity-30 disabled:hover:text-gray-300 leading-none px-1 transition"
                        title={t('moveUp')}
                      >▲</button>
                      <button
                        type="button"
                        onClick={() => movePackage(pkg.id, 1)}
                        disabled={visiblePackages.findIndex(p => p.id === pkg.id) === visiblePackages.length - 1}
                        className="text-gray-300 hover:text-gray-700 disabled:opacity-30 disabled:hover:text-gray-300 leading-none px-1 transition"
                        title={t('moveDown')}
                      >▼</button>
                    </div>
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
                    {pkg.is_drop_in && (
                      <span className="text-xs bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full font-medium">
                        {t('badgeDropIn')}
                      </span>
                    )}
                  </div>
                </div>
                {pkgDescription(pkg) && <p className="text-xs text-gray-500 mb-3">{pkgDescription(pkg)}</p>}
                {/* Le stesse cifre che legge l'allieva in vetrina: la scuola
                    deve poter vedere cosa sta pubblicando prima di pubblicarlo.
                    Se i tipi coperti costano crediti diversi il backend non
                    manda un numero di lezioni — non esiste — e la card torna a
                    crediti e prezzo per credito, com'era. Idem per i pacchetti
                    HQ, che non appartengono a una scuola. */}
                <div className="grid grid-cols-4 gap-3 text-xs mb-4">
                  <div>
                    <p className="text-red-600 font-semibold">
                      {pkg.lessons_included ? t('colLessons') : t('colCredits')}
                    </p>
                    <p className="font-bold text-gray-900 mt-0.5">
                      {pkg.is_unlimited
                        ? t('badgeUnlimited')
                        : pkg.lessons_included ?? formatCredits(pkg.credits)}
                    </p>
                  </div>
                  <div>
                    <p className="text-red-600 font-semibold">{t('colTotalPrice')}</p>
                    <p className="font-bold text-gray-900 mt-0.5">€{Number(pkg.price).toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-red-600 font-semibold">
                      {pkg.price_per_lesson ? t('colPricePerLesson') : t('colPricePerCredit')}
                    </p>
                    <p className="font-bold text-gray-900 mt-0.5">
                      €{pkg.price_per_lesson ?? (Number(pkg.price) / Number(pkg.credits)).toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-red-600 font-semibold">{pkg.is_recurring ? t('colInterval') : t('colValidFor')}</p>
                    <p className="font-bold text-gray-900 mt-0.5">{pkg.is_recurring ? (intervalOptions.find(o => o.value === pkg.recurring_interval)?.label ?? '–') : validityLabel(pkg.validity_days, pkg.validity_unit)}</p>
                  </div>
                </div>
                {/* La contabilita' in crediti resta leggibile, ma in secondo piano */}
                {!pkg.is_unlimited && pkg.lesson_credit_cost && (
                  <p className="text-xs text-gray-400 -mt-2 mb-3">
                    {t('creditsDetail', {
                      credits: formatCredits(pkg.credits),
                      cost: formatCredits(pkg.lesson_credit_cost),
                      perCredit: (Number(pkg.price) / Number(pkg.credits)).toFixed(2),
                    })}
                  </p>
                )}
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
                  {/* Un pacchetto gia' acquistato non si elimina: lo storico
                      dell'allieva ci punta. Prima il bottone spariva e basta,
                      e sembrava un guasto — ora resta li', spento, e dice
                      perche' e cosa fare al suo posto. */}
                  <button
                    onClick={() => { if (!pkg.has_purchases) handleDelete(pkg) }}
                    disabled={pkg.has_purchases}
                    title={pkg.has_purchases ? t('deleteBlockedPurchased') : undefined}
                    className={`flex-1 px-3 py-1.5 border rounded-lg text-xs transition ${
                      pkg.has_purchases
                        ? 'border-gray-200 text-gray-300 cursor-not-allowed'
                        : 'border-red-200 text-red-600 hover:bg-red-50'
                    }`}
                  >
                    {t('delete')}
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
