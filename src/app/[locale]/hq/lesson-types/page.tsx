'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

type LessonType = {
  id: string
  code: string
  name_it: string
  name_en: string
  name_fr: string | null
  name_es: string | null
  level: string
  description_en: string | null
  active: boolean
}

const EMPTY_FORM = {
  code: '', name_it: '', name_en: '', name_fr: '', name_es: '',
  level: 'all', description_it: '', description_en: '',
}

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
    const res = await fetch('/api/hq/lesson-types')
    if (res.ok) setTypes(await res.json())
    setLoading(false)
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
      description_it: '',
      description_en: lt.description_en ?? '',
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
      description_it: '',
      description_en: lt.description_en ?? '',
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
      description_en: form.description_en || null,
      description_it: form.description_it || null,
    }

    let res: Response
    if (editing) {
      res = await fetch(`/api/hq/lesson-types/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } else {
      res = await fetch('/api/hq/lesson-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    }

    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? 'Something went wrong')
    } else {
      setShowForm(false)
      await fetchTypes()
    }
    setSubmitting(false)
  }

  async function handleDeactivate(id: string) {
    if (!confirm(t('confirmDeactivate'))) return
    await fetch(`/api/hq/lesson-types/${id}`, { method: 'DELETE' })
    setTypes((types) => types.filter((x) => x.id !== id))
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

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-100 p-6 mb-6 space-y-4">
          <h3 className="font-semibold text-gray-900">
            {editing ? t('formEditTitle') : isCopying ? t('formCopyTitle') : t('formNewTitle')}
          </h3>
          {error && <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}

          <div className="grid grid-cols-3 gap-4">
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
            <div className="col-span-2">
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('labelNameIT')}</label>
              <input
                required
                value={form.name_it}
                onChange={(e) => setForm((f) => ({ ...f, name_it: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                placeholder={t('placeholderNameIT')}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('labelNameEN')}</label>
              <input
                required
                value={form.name_en}
                onChange={(e) => setForm((f) => ({ ...f, name_en: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                placeholder={t('placeholderNameEN')}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('labelNameFR')}</label>
              <input
                value={form.name_fr}
                onChange={(e) => setForm((f) => ({ ...f, name_fr: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                placeholder={t('placeholderNameFR')}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('labelNameES')}</label>
              <input
                value={form.name_es}
                onChange={(e) => setForm((f) => ({ ...f, name_es: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                placeholder={t('placeholderNameES')}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('labelDescription')}</label>
            <textarea
              value={form.description_en}
              onChange={(e) => setForm((f) => ({ ...f, description_en: e.target.value }))}
              rows={2}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
              placeholder={t('placeholderDescription')}
            />
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
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {!types.length ? (
          <div className="p-8 text-center text-sm text-gray-400">
            {t('emptyState')}
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('headerCode')}</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('headerName')}</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('labelLevel')}</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('headerLanguages')}</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {types.map((lt) => (
                <tr key={lt.id} className="hover:bg-gray-50 transition">
                  <td className="px-6 py-3">
                    <span className="text-xs font-mono bg-[#6B1F3A]/10 text-[#6B1F3A] px-2 py-0.5 rounded">
                      {lt.code}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    <p className="font-medium text-gray-900 text-sm">{lt.name_en}</p>
                    <p className="text-xs text-gray-400">{lt.name_it}</p>
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-500 capitalize">{lt.level}</td>
                  <td className="px-6 py-3">
                    <div className="flex gap-1">
                      {['IT', 'EN', lt.name_fr ? 'FR' : null, lt.name_es ? 'ES' : null]
                        .filter(Boolean)
                        .map((lang) => (
                          <span key={lang} className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                            {lang}
                          </span>
                        ))}
                    </div>
                  </td>
                  <td className="px-6 py-3 text-right space-x-3">
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
                      onClick={() => handleDeactivate(lt.id)}
                      className="text-xs text-red-400 hover:text-red-600"
                    >
                      {t('actionDeactivate')}
                    </button>
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
