'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { SchoolDocumentType } from '@/lib/documents'
import { apiFetch } from '@/lib/api/client'

// Impostazioni → Documenti: la scuola decide quali documenti chiedere alle
// allieve, con quali varianti (es. carta d'identità / passaporto), se hanno
// scadenza e se sono obbligatori.
export default function DocumentTypesManager() {
  const t = useTranslations('school.documentTypes')
  const [types, setTypes] = useState<SchoolDocumentType[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    try {
      setTypes(await apiFetch<SchoolDocumentType[]>('/school/document-types/'))
    } catch {
      // no-op
    }
    setLoading(false)
  }

  async function patch(id: string, body: Partial<SchoolDocumentType>) {
    setBusy(id)
    // Aggiornamento ottimistico: la riga risponde subito al clic
    setTypes(prev => prev.map(t => t.id === id ? { ...t, ...body } as SchoolDocumentType : t))
    try {
      await apiFetch(`/school/document-types/${id}/`, { method: 'PATCH', body: JSON.stringify(body) })
    } catch {
      setError(t('errorSave'))
      await load()
    }
    setBusy(null)
  }

  async function addType() {
    const name = newName.trim()
    if (!name) return
    setBusy('new')
    setError(null)
    try {
      await apiFetch('/school/document-types/', { method: 'POST', body: JSON.stringify({ name }) })
      setNewName('')
      await load()
    } catch {
      setError(t('errorSave'))
    }
    setBusy(null)
  }

  async function removeType(id: string) {
    setBusy(id)
    try {
      const data = await apiFetch<{ deactivated?: boolean; documents?: number } | undefined>(`/school/document-types/${id}/`, { method: 'DELETE' })
      if (data?.deactivated) setError(t('deactivatedInstead', { count: data.documents ?? 0 }))
    } catch {
      setError(t('errorSave'))
    }
    await load()
    setBusy(null)
  }

  if (loading) return <p className="text-sm text-gray-400">{t('loading')}</p>

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">{error}</p>}

      {types.map(type => (
        <div key={type.id} className={`border border-gray-200 rounded-xl p-4 ${type.active ? '' : 'opacity-50'}`}>
          <div className="flex items-start gap-3">
            <input
              value={type.name}
              onChange={e => setTypes(prev => prev.map(x => x.id === type.id ? { ...x, name: e.target.value } : x))}
              onBlur={e => patch(type.id, { name: e.target.value })}
              className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
            />
            <button
              type="button"
              onClick={() => removeType(type.id)}
              disabled={busy === type.id}
              className="w-9 h-9 rounded-lg border border-gray-200 text-red-400 hover:text-red-600 hover:bg-red-50 transition shrink-0"
            >
              ✕
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-3">
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" checked={type.required} onChange={e => patch(type.id, { required: e.target.checked })} className="accent-[#6B1F3A]" />
              {t('required')}
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" checked={type.has_expiry} onChange={e => patch(type.id, { has_expiry: e.target.checked })} className="accent-[#6B1F3A]" />
              {t('hasExpiry')}
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" checked={type.active} onChange={e => patch(type.id, { active: e.target.checked })} className="accent-[#6B1F3A]" />
              {t('active')}
            </label>
          </div>

          <div className="mt-3">
            <label className="block text-[11px] text-gray-400 mb-1">{t('variantsLabel')}</label>
            <input
              defaultValue={type.variants.join(', ')}
              onBlur={e => patch(type.id, { variants: e.target.value.split(',').map(v => v.trim()).filter(Boolean) })}
              placeholder={t('variantsPlaceholder')}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
            />
            <p className="text-[11px] text-gray-400 mt-1">{t('variantsHint')}</p>
          </div>
        </div>
      ))}

      <div className="flex items-center gap-2">
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addType() } }}
          placeholder={t('newPlaceholder')}
          className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
        />
        <button
          type="button"
          onClick={addType}
          disabled={busy === 'new' || !newName.trim()}
          className="px-4 py-2 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-40"
        >
          {t('add')}
        </button>
      </div>
    </div>
  )
}
