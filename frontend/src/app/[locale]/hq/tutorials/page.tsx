'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import PlatformVisibilityToggle from '@/components/hq/PlatformVisibilityToggle'
import MultiFilterSelect from '@/components/ui/MultiFilterSelect'
import { locales } from '@/i18n/routing'
import { apiFetch, ApiError, apiUrl } from '@/lib/api/client'
import { languageDisplayName } from '@/lib/language-names'
import { getVideoThumbnail } from '@/lib/video-embed'

// Tutorial per le allieve (video o PDF), una riga per lingua: niente
// title_it/title_en, HQ carica la stessa guida una volta per ogni lingua che
// vuole offrire. Backend: library/views.py (HQTutorialViewSet).
export type Tutorial = {
  id: string
  title: string
  description: string
  type: 'video' | 'pdf'
  language: string
  topic: string
  video_url: string
  file_url: string | null
  file_name: string
  file_size: number | null
  thumbnail_url: string
  sort_order: number
  active: boolean
  created_at: string
  updated_at: string
}

const EMPTY_FORM = {
  title: '',
  type: 'video' as Tutorial['type'],
  language: 'en',
  topic: '',
  description: '',
  video_url: '',
  thumbnail_url: '',
  sort_order: '0',
  active: true,
}

// Stesso limite di library/tutorial_files.py (MAX_TUTORIAL_PDF_BYTES)
const MAX_PDF_MB = 20

const inputCls = 'w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

// Il backend risponde {error: code} per gli upload e {campo: [...]} per la
// validazione DRF: qui si riduce tutto a una chiave di messaggio.
function errorCode(err: unknown): string | null {
  if (err instanceof ApiError && err.body && typeof err.body === 'object') {
    const body = err.body as Record<string, unknown>
    if (typeof body.error === 'string') return body.error
    if (body.video_url) return 'video_url'
  }
  return null
}

function formatSize(bytes: number | null, locale: string): string {
  if (!bytes) return ''
  const mb = bytes / (1024 * 1024)
  return mb >= 1
    ? `${mb.toLocaleString(locale, { maximumFractionDigits: 1 })} MB`
    : `${Math.max(1, Math.round(bytes / 1024)).toLocaleString(locale)} KB`
}

export default function HQTutorialsPage() {
  const t = useTranslations('hq.tutorials')
  const uiLocale = useLocale()
  const [items, setItems] = useState<Tutorial[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Tutorial | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filtri (sempre multiselezione), applicati lato client sulla lista completa
  const [filterLang, setFilterLang] = useState<string[]>([])
  const [filterType, setFilterType] = useState<string[]>([])
  const [filterTopic, setFilterTopic] = useState<string[]>([])

  const langName = (code: string) => languageDisplayName(code, uiLocale)
  const languageOptions = useMemo(
    () => locales.map((code) => ({ value: code, label: langName(code) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uiLocale]
  )

  useEffect(() => { fetchItems() }, [])

  async function fetchItems() {
    setLoading(true)
    const data = await apiFetch<Tutorial[]>('/hq/tutorials/').catch(() => [])
    setItems(data)
    setLoading(false)
  }

  // Gli argomenti sono nella lingua del tutorial: le opzioni seguono le
  // lingue scelte, altrimenti "Prenotazioni" e "Bookings" si mescolano.
  const topicOptions = useMemo(() => {
    const pool = filterLang.length ? items.filter((i) => filterLang.includes(i.language)) : items
    return [...new Set(pool.map((i) => i.topic).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, uiLocale))
      .map((topic) => ({ value: topic, label: topic }))
  }, [items, filterLang, uiLocale])

  // Suggerimenti per il campo argomento: quelli già usati nella stessa lingua
  const formTopics = useMemo(
    () => [...new Set(items.filter((i) => i.language === form.language).map((i) => i.topic).filter(Boolean))],
    [items, form.language]
  )

  const visible = items.filter(
    (i) =>
      (!filterLang.length || filterLang.includes(i.language)) &&
      (!filterType.length || filterType.includes(i.type)) &&
      (!filterTopic.length || filterTopic.includes(i.topic))
  )
  const hasFilter = !!(filterLang.length || filterType.length || filterTopic.length)

  function resetFile() {
    setPendingFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function openNew() {
    setEditing(null)
    setForm({ ...EMPTY_FORM, language: filterLang.length === 1 ? filterLang[0] : EMPTY_FORM.language })
    resetFile()
    setError(null)
    setShowForm(true)
  }

  function openEdit(item: Tutorial) {
    setEditing(item)
    setForm({
      title: item.title,
      type: item.type,
      language: item.language,
      topic: item.topic,
      description: item.description,
      video_url: item.video_url,
      thumbnail_url: item.thumbnail_url,
      sort_order: String(item.sort_order),
      active: item.active,
    })
    resetFile()
    setError(null)
    setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    const payload = {
      title: form.title,
      type: form.type,
      language: form.language,
      topic: form.topic,
      description: form.description,
      video_url: form.type === 'video' ? form.video_url : '',
      thumbnail_url: form.thumbnail_url,
      sort_order: Number(form.sort_order) || 0,
      active: form.active,
    }

    try {
      let saved: Tutorial
      if (editing) {
        saved = await apiFetch<Tutorial>(`/hq/tutorials/${editing.id}/`, { method: 'PATCH', body: JSON.stringify(payload) })
      } else {
        saved = await apiFetch<Tutorial>('/hq/tutorials/', { method: 'POST', body: JSON.stringify(payload) })
        // Da qui in poi la riga esiste: se l'upload sotto fallisce, un nuovo
        // "Salva" deve aggiornarla, non crearne una seconda.
        setEditing(saved)
      }
      if (form.type === 'pdf' && pendingFile) {
        const body = new FormData()
        body.append('file', pendingFile)
        await apiFetch(`/hq/tutorials/${saved.id}/file/`, { method: 'POST', body })
      }
      setShowForm(false)
      resetFile()
      await fetchItems()
    } catch (err) {
      const code = errorCode(err)
      setError(
        code === 'invalid_type' ? t('errorNotPdf')
          : code === 'too_large' ? t('errorTooLarge', { max: MAX_PDF_MB })
          : code === 'video_url' ? t('errorVideoUrl')
          : t('errorFailed')
      )
      await fetchItems()
    }
    setSubmitting(false)
  }

  async function handleRemoveFile() {
    if (!editing || !confirm(t('confirmRemoveFile'))) return
    const updated = await apiFetch<Tutorial>(`/hq/tutorials/${editing.id}/file/`, { method: 'DELETE' }).catch(() => null)
    if (!updated) return
    setEditing(updated)
    setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
  }

  async function handleDelete(id: string) {
    if (!confirm(t('confirmDelete'))) return
    await apiFetch(`/hq/tutorials/${id}/`, { method: 'DELETE' }).catch(() => {})
    setItems((prev) => prev.filter((x) => x.id !== id))
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
          <p className="text-gray-500 text-sm mt-1">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          {/* Mostra/nascondi la voce Tutorial nella barra del pannello studente */}
          <PlatformVisibilityToggle
            endpoint="/hq/student-tutorials-visibility/"
            onLabel={t('visibleToStudents')}
            offLabel={t('hiddenFromStudents')}
            hint={t('visibilityHint')}
            offTone="amber"
          />
          <button
            onClick={openNew}
            className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition"
          >
            {t('buttonNew')}
          </button>
        </div>
      </div>

      {/* Filtri */}
      <div className="flex gap-2 mb-6 flex-wrap items-center">
        <MultiFilterSelect label={t('filterLanguage')} options={languageOptions} selected={filterLang} onChange={(v) => { setFilterLang(v); setFilterTopic([]) }} />
        <MultiFilterSelect
          label={t('filterType')}
          options={[{ value: 'video', label: t('typeVideo') }, { value: 'pdf', label: t('typePdf') }]}
          selected={filterType}
          onChange={setFilterType}
        />
        <MultiFilterSelect label={t('filterTopic')} options={topicOptions} selected={filterTopic} onChange={setFilterTopic} />
        {hasFilter && (
          <button
            type="button"
            onClick={() => { setFilterLang([]); setFilterType([]); setFilterTopic([]) }}
            className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5"
          >
            {t('clearFilters')}
          </button>
        )}
        <span className="text-xs text-gray-400 ml-auto">{t('countLabel', { count: visible.length })}</span>
      </div>

      {/* Form nuovo / modifica */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-100 p-6 mb-6 space-y-4">
          <h3 className="font-semibold text-gray-900">{editing ? t('formEditTitle') : t('formNewTitle')}</h3>
          {error && <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className={labelCls}>{t('labelTitle')}</label>
              <input
                required
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                className={inputCls}
                placeholder={t('placeholderTitle')}
              />
            </div>
            <div>
              <label className={labelCls}>{t('labelType')}</label>
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as Tutorial['type'] }))}
                className={inputCls}
              >
                <option value="video">{t('typeVideo')}</option>
                <option value="pdf">{t('typePdf')}</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>{t('labelLanguage')}</label>
              <select
                value={form.language}
                onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}
                className={inputCls}
              >
                {languageOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>{t('labelTopic')}</label>
              <input
                list="hq-tutorial-topics"
                value={form.topic}
                onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))}
                className={inputCls}
                placeholder={t('placeholderTopic')}
                maxLength={80}
              />
              <datalist id="hq-tutorial-topics">
                {formTopics.map((topic) => <option key={topic} value={topic} />)}
              </datalist>
              <p className="text-[11px] text-gray-400 mt-1">{t('hintTopic')}</p>
            </div>
            <div>
              <label className={labelCls}>{t('labelSortOrder')}</label>
              <input
                type="number"
                value={form.sort_order}
                onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
                className={inputCls}
              />
              <p className="text-[11px] text-gray-400 mt-1">{t('hintSortOrder')}</p>
            </div>

            {form.type === 'video' ? (
              <div className="md:col-span-2">
                <label className={labelCls}>{t('labelVideoUrl')}</label>
                <input
                  required
                  type="url"
                  value={form.video_url}
                  onChange={(e) => setForm((f) => ({ ...f, video_url: e.target.value }))}
                  className={inputCls}
                  placeholder={t('placeholderVideoUrl')}
                />
              </div>
            ) : (
              <div className="md:col-span-2">
                <label className={labelCls}>{t('labelFile')}</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-gray-600 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
                />
                <p className="text-[11px] text-gray-400 mt-1">{t('hintFile', { max: MAX_PDF_MB })}</p>
                {editing?.file_url && !pendingFile ? (
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                    <span>{t('fileCurrent', { name: editing.file_name })} {formatSize(editing.file_size, uiLocale)}</span>
                    <a href={apiUrl(editing.file_url)} target="_blank" rel="noopener noreferrer" className="text-[#6B1F3A] hover:underline">{t('openPdf')}</a>
                    <button type="button" onClick={handleRemoveFile} className="text-red-400 hover:text-red-600">{t('buttonRemoveFile')}</button>
                  </div>
                ) : !pendingFile ? (
                  <p className="text-[11px] text-amber-600 mt-1">{t('fileMissing')}</p>
                ) : null}
              </div>
            )}

            <div className="md:col-span-2">
              <label className={labelCls}>{t('labelDescription')}</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
                className={inputCls}
                placeholder={t('placeholderDescription')}
              />
            </div>
            <div className="md:col-span-2">
              <label className={labelCls}>{t('labelThumbnailUrl')}</label>
              <input
                type="url"
                value={form.thumbnail_url}
                onChange={(e) => setForm((f) => ({ ...f, thumbnail_url: e.target.value }))}
                className={inputCls}
                placeholder="https://..."
              />
              <p className="text-[11px] text-gray-400 mt-1">{t('hintThumbnail')}</p>
            </div>
            <div className="md:col-span-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                  className="w-4 h-4 accent-[#6B1F3A]"
                />
                <span className="text-sm text-gray-700">{t('labelActive')}</span>
              </label>
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-[#5a1930] transition"
            >
              {submitting ? t('buttonSaving') : t('buttonSave')}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); resetFile() }}
              className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition"
            >
              {t('buttonCancel')}
            </button>
          </div>
        </form>
      )}

      {/* Elenco */}
      {loading ? (
        <div className="text-sm text-gray-400">{t('loading')}</div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-gray-400 text-sm">{t('emptyState')}</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-gray-400 text-sm">{t('emptyFiltered')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map((item) => {
            const thumb = item.thumbnail_url || (item.type === 'video' ? getVideoThumbnail(item.video_url) : null)
            const href = item.type === 'video' ? item.video_url : item.file_url ? apiUrl(item.file_url) : null
            return (
              <div key={item.id} className={`bg-white rounded-xl border p-4 flex flex-col gap-3 ${item.active ? 'border-gray-100' : 'border-dashed border-gray-300 opacity-70'}`}>
                {thumb ? (
                  <div className="w-full h-32 rounded-lg overflow-hidden bg-gray-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={thumb} alt="" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="w-full h-32 rounded-lg bg-gray-100 flex items-center justify-center">
                    <span className="text-gray-300 text-3xl">{item.type === 'video' ? '▶' : '📄'}</span>
                  </div>
                )}
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${item.type === 'video' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                      {item.type === 'video' ? t('typeVideo') : t('typePdf')}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{langName(item.language)}</span>
                    {item.topic && <span className="text-xs px-2 py-0.5 rounded-full bg-[#6B1F3A]/10 text-[#6B1F3A]">{item.topic}</span>}
                    {!item.active && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">{t('badgeInactive')}</span>}
                    {item.type === 'pdf' && !item.file_url && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{t('badgeNoFile')}</span>}
                  </div>
                  <p className="font-medium text-gray-900 text-sm leading-snug">{item.title}</p>
                  {item.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{item.description}</p>}
                  <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-400">
                    {item.type === 'pdf' && item.file_name && <span>{item.file_name} {formatSize(item.file_size, uiLocale)}</span>}
                    {href && (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#6B1F3A] hover:underline">
                        {item.type === 'video' ? t('openVideo') : t('openPdf')}
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 pt-1 border-t border-gray-50">
                  <button onClick={() => openEdit(item)} className="flex-1 text-xs text-gray-500 hover:text-gray-800 py-1 transition">
                    {t('actionEdit')}
                  </button>
                  <button onClick={() => handleDelete(item.id)} className="flex-1 text-xs text-red-400 hover:text-red-600 py-1 transition">
                    {t('actionDelete')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
