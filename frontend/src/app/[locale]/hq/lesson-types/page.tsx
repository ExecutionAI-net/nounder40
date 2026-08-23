'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import ConfirmDeleteButton from '@/components/ui/ConfirmDeleteButton'
import ErrorBanner from '@/components/ui/ErrorBanner'
import ImageUploadInput from '@/components/ui/ImageUploadInput'
import { apiFetch, ApiError } from '@/lib/api/client'

function errMsg(err: unknown, fallback: string): string {
  if (err instanceof ApiError && typeof err.body === 'object' && err.body) {
    return (err.body as { error?: string }).error ?? fallback
  }
  return fallback
}

type LessonType = {
  id: string
  code: string
  name_it: string
  name_en: string
  name_fr: string | null
  name_es: string | null
  level: string
  description_it: string | null
  description_en: string | null
  description_fr: string | null
  description_es: string | null
  active: boolean
  image_url: string | null
  image_url_it: string | null
  image_url_en: string | null
  image_url_fr: string | null
  image_url_es: string | null
  video_url_it: string | null
  video_url_en: string | null
  video_url_fr: string | null
  video_url_es: string | null
}

const EMPTY_FORM = {
  code: '', name_it: '', name_en: '', name_fr: '', name_es: '',
  level: 'all',
  description_it: '', description_en: '', description_fr: '', description_es: '',
  video_url_it: '', video_url_en: '', video_url_fr: '', video_url_es: '',
}

// FR rimosso: le lingue del catalogo sono allineate a quelle del profilo scuola (IT/EN/ES)
const LANGS = ['it', 'en', 'es'] as const

export default function LessonTypesPage() {
  const t = useTranslations('hq.lesson-types')

  const LEVELS = [
    { value: 'all', label: t('filterAllLevels') },
    { value: 'entry', label: t('filterEntry') },
    { value: 'intermediate', label: t('filterIntermediate') },
    { value: 'advanced', label: t('filterAdvanced') },
  ]

  const [types, setTypes] = useState<LessonType[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<LessonType | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [isCopying, setIsCopying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { fetchTypes() }, [])

  async function fetchTypes() {
    try {
      setTypes(await apiFetch<LessonType[]>('/hq/lesson-types/'))
    } catch { /* no-op */ }
    setLoading(false)
  }

  // Sposta un tipo lezione su/giù: il movimento è immediato, il salvataggio
  // parte ~2s dopo l'ULTIMO movimento (debounce: niente una chiamata per click)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingIds = useRef<string[] | null>(null)

  async function persistOrder(ids: string[]) {
    pendingIds.current = null
    try {
      await apiFetch('/hq/lesson-types/reorder/', { method: 'POST', body: JSON.stringify({ ids }) })
    } catch (err) {
      setError(errMsg(err, 'Reorder failed'))
      await fetchTypes() // ripristina l'ordine reale
    }
  }

  // se si lascia la pagina con un salvataggio in sospeso, salva subito
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    if (pendingIds.current) void persistOrder(pendingIds.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function moveType(id: string, dir: -1 | 1) {
    const displayed = [...types].sort((a, b) => Number(b.active) - Number(a.active))
    const idx = displayed.findIndex(x => x.id === id)
    const target = idx + dir
    if (idx < 0 || target < 0 || target >= displayed.length) return
    ;[displayed[idx], displayed[target]] = [displayed[target], displayed[idx]]
    setTypes(displayed)
    const ids = displayed.map(x => x.id)
    pendingIds.current = ids
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => persistOrder(ids), 2000)
  }

  function openNew() {
    setEditing(null)
    setIsCopying(false)
    setForm(EMPTY_FORM)
    setError(null)
    setShowForm(true)
  }

  function openEdit(lt: LessonType) {
    setIsCopying(false)
    setEditing(lt)
    setForm({
      code: lt.code,
      name_it: lt.name_it,
      name_en: lt.name_en,
      name_fr: lt.name_fr ?? '',
      name_es: lt.name_es ?? '',
      level: lt.level,
      description_it: lt.description_it ?? '',
      description_en: lt.description_en ?? '',
      description_fr: lt.description_fr ?? '',
      description_es: lt.description_es ?? '',
      video_url_it: lt.video_url_it ?? '',
      video_url_en: lt.video_url_en ?? '',
      video_url_fr: lt.video_url_fr ?? '',
      video_url_es: lt.video_url_es ?? '',
    })
    setError(null)
    setShowForm(true)
  }

  function openCopy(lt: LessonType) {
    setIsCopying(true)
    setEditing(null)
    setForm({
      code: lt.code + '_COPY',
      name_it: lt.name_it + ' (Copy)',
      name_en: lt.name_en + ' (Copy)',
      name_fr: lt.name_fr ?? '',
      name_es: lt.name_es ?? '',
      level: lt.level,
      description_it: lt.description_it ?? '',
      description_en: lt.description_en ?? '',
      description_fr: lt.description_fr ?? '',
      description_es: lt.description_es ?? '',
      video_url_it: lt.video_url_it ?? '',
      video_url_en: lt.video_url_en ?? '',
      video_url_fr: lt.video_url_fr ?? '',
      video_url_es: lt.video_url_es ?? '',
    })
    setError(null)
    setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    const payload = {
      ...form,
      name_fr: form.name_fr || null,
      name_es: form.name_es || null,
      description_it: form.description_it || null,
      description_en: form.description_en || null,
      description_fr: form.description_fr || null,
      description_es: form.description_es || null,
      video_url_it: form.video_url_it || null,
      video_url_en: form.video_url_en || null,
      video_url_fr: form.video_url_fr || null,
      video_url_es: form.video_url_es || null,
    }

    try {
      if (editing) {
        await apiFetch(`/hq/lesson-types/${editing.id}/`, { method: 'PATCH', body: JSON.stringify(payload) })
      } else {
        await apiFetch('/hq/lesson-types/', { method: 'POST', body: JSON.stringify(payload) })
      }
      setShowForm(false)
      await fetchTypes()
    } catch (err) {
      setError(errMsg(err, 'Something went wrong'))
    }
    setSubmitting(false)
  }

  // Deactivate/reactivate is reversible → single click toggle
  async function toggleActive(lt: LessonType) {
    setError(null)
    try {
      await apiFetch(`/hq/lesson-types/${lt.id}/`, { method: 'PATCH', body: JSON.stringify({ active: !lt.active }) })
      await fetchTypes()
    } catch (err) {
      setError(errMsg(err, 'Error'))
    }
  }

  // Hard delete: first click shows linked courses/lessons, blocked when in use
  async function armDelete(lt: LessonType): Promise<string | null> {
    setError(null)
    let data: { courses: number; lessons: number }
    try {
      data = await apiFetch(`/hq/lesson-types/${lt.id}/`)
    } catch {
      setError('Error'); return null
    }
    if (data.courses > 0 || data.lessons > 0) {
      setError(t('deleteBlockedInUse', { name: lt.name_it, courses: data.courses, lessons: data.lessons }))
      return null
    }
    return t('deleteArmed')
  }

  async function handleDelete(id: string) {
    setError(null)
    try {
      await apiFetch(`/hq/lesson-types/${id}/`, { method: 'DELETE' })
      setTypes((types) => types.filter((x) => x.id !== id))
    } catch (err) {
      const body = err instanceof ApiError ? err.body as { error?: string; courses?: number; lessons?: number } : null
      setError(body?.error === 'in_use' ? t('deleteBlockedInUse', { name: '', courses: body.courses ?? 0, lessons: body.lessons ?? 0 }) : body?.error ?? 'Error')
    }
  }

  if (loading) return <div className="text-sm text-gray-400">{t('loading')}</div>

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
          <p className="text-gray-500 text-sm mt-1">{t('subtitle', { count: types.length })}</p>
        </div>
        <button
          onClick={openNew}
          className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition"
        >
          {t('buttonNew')}
        </button>
      </div>

      <ErrorBanner message={error && !showForm ? error : null} onDismiss={() => setError(null)} />

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-100 p-6 mb-6 space-y-4">
          <h3 className="font-semibold text-gray-900">
            {editing ? t('formEditTitle') : isCopying ? t('formCopyTitle') : t('formNewTitle')}
          </h3>
          {error && <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('labelCode')}</label>
              <input
                required
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                placeholder={t('placeholderCode')}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('labelLevel')}</label>
              <select
                value={form.level}
                onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
              >
                {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </div>
          </div>

          {/* Sezioni per lingua: nome, descrizione, video */}
          <div className="space-y-3">
            {LANGS.map(lang => (
              <div key={lang} className="border border-gray-100 rounded-xl p-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{t(`langSection_${lang}`)}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t('labelName')}</label>
                    <input
                      required={lang === 'it' || lang === 'en'}
                      value={form[`name_${lang}`]}
                      onChange={(e) => setForm((f) => ({ ...f, [`name_${lang}`]: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t('labelVideoUrl', { lang: lang.toUpperCase() })}</label>
                    <input
                      type="url"
                      value={form[`video_url_${lang}`]}
                      onChange={(e) => setForm((f) => ({ ...f, [`video_url_${lang}`]: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                      placeholder={t('placeholderVideoUrl')}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t('labelDescription')}</label>
                    <textarea
                      value={form[`description_${lang}`]}
                      onChange={(e) => setForm((f) => ({ ...f, [`description_${lang}`]: e.target.value }))}
                      rows={2}
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                      placeholder={t('placeholderDescription')}
                    />
                  </div>
                  {editing && (
                    <div className="sm:col-span-2">
                      <ImageUploadInput
                        endpoint={`/hq/lesson-types/${editing.id}/image/?lang=${lang}`}
                        imageUrl={editing[`image_url_${lang}`]}
                        onChange={(url) => { setEditing(e => e ? { ...e, [`image_url_${lang}`]: url } : e); fetchTypes() }}
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {submitting ? t('buttonSaving') : editing ? t('buttonSave') : isCopying ? t('buttonCopy') : t('buttonCreate')}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setIsCopying(false) }}
              className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600"
            >
              {t('buttonCancel')}
            </button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
        {!types.length ? (
          <div className="p-8 text-center text-sm text-gray-400">
            {t('emptyState')}
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide whitespace-nowrap">{t('headerCode')}</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide whitespace-nowrap">{t('headerName')}</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide whitespace-nowrap">{t('labelLevel')}</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide whitespace-nowrap">{t('headerLanguages')}</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {[...types].sort((a, b) => Number(b.active) - Number(a.active)).map((lt, idx, arr) => (
                <tr key={lt.id} className={`hover:bg-gray-50 transition ${lt.active ? '' : 'opacity-50 bg-gray-50/50'}`}>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2">
                      {/* frecce ordinamento catalogo */}
                      <div className="flex flex-col">
                        <button onClick={() => moveType(lt.id, -1)} disabled={idx === 0}
                          className="text-gray-300 hover:text-gray-700 disabled:opacity-30 disabled:hover:text-gray-300 leading-none px-0.5 transition">▲</button>
                        <button onClick={() => moveType(lt.id, 1)} disabled={idx === arr.length - 1}
                          className="text-gray-300 hover:text-gray-700 disabled:opacity-30 disabled:hover:text-gray-300 leading-none px-0.5 transition">▼</button>
                      </div>
                      <span className="text-xs font-mono bg-[#6B1F3A]/10 text-[#6B1F3A] px-2 py-0.5 rounded">
                        {lt.code}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-3">
                    <p className="font-medium text-gray-900 text-sm">{lt.name_en}</p>
                    <p className="text-xs text-gray-400">{lt.name_it}</p>
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-500 capitalize whitespace-nowrap">
                    {lt.level}
                    <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${lt.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {lt.active ? t('badgeActive') : t('badgeInactive')}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex gap-1">
                      {['IT', 'EN', lt.name_es ? 'ES' : null]
                        .filter(Boolean)
                        .map((lang) => (
                          <span key={lang} className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                            {lang}
                          </span>
                        ))}
                    </div>
                  </td>
                  <td className="px-6 py-3 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => openEdit(lt)}
                        className="text-xs text-gray-400 hover:text-gray-700"
                      >
                        {t('actionEdit')}
                      </button>
                      <button
                        onClick={() => openCopy(lt)}
                        className="text-xs text-blue-400 hover:text-blue-600"
                      >
                        {t('actionCopy')}
                      </button>
                      <button
                        onClick={() => toggleActive(lt)}
                        className="text-xs text-amber-500 hover:text-amber-700"
                      >
                        {lt.active ? t('actionDeactivate') : t('actionActivate')}
                      </button>
                      <ConfirmDeleteButton
                        label={t('actionDelete')}
                        armedLabel={t('deleteArmed')}
                        onArm={() => armDelete(lt)}
                        onDelete={() => handleDelete(lt.id)}
                        className="text-red-400 hover:text-red-600 border-0 px-0"
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
