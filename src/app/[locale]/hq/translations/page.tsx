'use client'

import { useEffect, useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'

const LOCALES = ['en', 'it', 'es', 'fr', 'de'] as const
type Locale = typeof LOCALES[number]

const LOCALE_LABELS: Record<Locale, string> = {
  en: '🇬🇧 EN',
  it: '🇮🇹 IT',
  es: '🇪🇸 ES',
  fr: '🇫🇷 FR',
  de: '🇩🇪 DE',
}

type TranslationRow = { key: string } & Partial<Record<Locale, string>>

export default function TranslationsPage() {
  const t = useTranslations('hq.translations')
  const [rows, setRows] = useState<TranslationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState<string | null>(null) // "key|locale"
  const [edited, setEdited] = useState<Record<string, string>>({}) // "key|locale" → value
  const [deleteKey, setDeleteKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/translations')
    const data = await res.json()
    setRows(data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const cellKey = (key: string, locale: Locale) => `${key}|${locale}`

  const getValue = (row: TranslationRow, locale: Locale) => {
    const ck = cellKey(row.key, locale)
    return edited[ck] !== undefined ? edited[ck] : (row[locale] ?? '')
  }

  const handleChange = (key: string, locale: Locale, value: string) => {
    setEdited(prev => ({ ...prev, [cellKey(key, locale)]: value }))
  }

  const handleSave = async (key: string, locale: Locale) => {
    const ck = cellKey(key, locale)
    const value = edited[ck]
    if (value === undefined) return

    setSaving(ck)
    await fetch('/api/translations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, locale, value }),
    })
    setSaving(null)
    setEdited(prev => {
      const next = { ...prev }
      delete next[ck]
      return next
    })
    await load()
  }

  const handleDelete = async (key: string) => {
    await fetch('/api/translations', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    })
    setDeleteKey(null)
    await load()
  }

  const filtered = rows.filter(r =>
    r.key.toLowerCase().includes(search.toLowerCase()) ||
    LOCALES.some(l => (r[l] ?? '').toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div className="p-6 max-w-screen-xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-sm text-gray-500 mt-1">
          {t('subtitle')} <code className="bg-gray-100 px-1 rounded text-xs">npm run sync-translations</code>
        </p>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <input
          type="text"
          placeholder={t('placeholderSearch')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 w-72"
        />
        <span className="text-sm text-gray-400">{t('keysCount', { count: filtered.length })}</span>
      </div>

      {loading ? (
        <div className="text-sm text-gray-400 py-12 text-center">{t('loading')}</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 font-medium text-gray-600 w-72">Key</th>
                  {LOCALES.map(l => (
                    <th key={l} className="text-left px-4 py-3 font-medium text-gray-600 min-w-[200px]">
                      {LOCALE_LABELS[l]}
                    </th>
                  ))}
                  <th className="px-4 py-3 w-16" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => (
                  <tr key={row.key} className={`border-b border-gray-100 ${i % 2 === 0 ? '' : 'bg-gray-50/50'}`}>
                    <td className="px-4 py-2">
                      <code className="text-xs text-[#6B1F3A] bg-[#6B1F3A]/5 px-1.5 py-0.5 rounded">
                        {row.key}
                      </code>
                    </td>
                    {LOCALES.map(locale => {
                      const ck = cellKey(row.key, locale)
                      const isEdited = edited[ck] !== undefined && edited[ck] !== (row[locale] ?? '')
                      const isSaving = saving === ck
                      return (
                        <td key={locale} className="px-4 py-2">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={getValue(row, locale)}
                              onChange={e => handleChange(row.key, locale, e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') handleSave(row.key, locale) }}
                              placeholder="—"
                              className={`flex-1 px-2 py-1 rounded border text-xs focus:outline-none focus:ring-1 focus:ring-[#6B1F3A]/30 ${
                                isEdited ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-white'
                              }`}
                            />
                            {isEdited && (
                              <button
                                onClick={() => handleSave(row.key, locale)}
                                disabled={isSaving}
                                className="px-2 py-1 rounded bg-[#6B1F3A] text-white text-xs font-medium hover:bg-[#5a1830] disabled:opacity-50 shrink-0"
                              >
                                {isSaving ? '...' : t('buttonSave')}
                              </button>
                            )}
                          </div>
                        </td>
                      )
                    })}
                    <td className="px-4 py-2 text-center">
                      {deleteKey === row.key ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleDelete(row.key)}
                            className="text-xs px-2 py-0.5 rounded bg-red-500 text-white hover:bg-red-600"
                          >
                            {t('buttonYes')}
                          </button>
                          <button
                            onClick={() => setDeleteKey(null)}
                            className="text-xs px-2 py-0.5 rounded bg-gray-200 text-gray-600 hover:bg-gray-300"
                          >
                            {t('buttonNo')}
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteKey(row.key)}
                          className="text-gray-300 hover:text-red-400 text-lg leading-none"
                          title={t('tooltipDelete')}
                        >
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={LOCALES.length + 2} className="px-4 py-12 text-center text-gray-400 text-sm">
                      {search ? t('emptySearch') : t('emptyState')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
