'use client'

import { useEffect, useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import MultiSelectFilter from '@/components/ui/MultiSelectFilter'
import StudentSheet from '@/components/school/StudentSheet'
import type { DocFile, DocStatus } from '@/lib/documents'

type Doc = {
  id: string
  type_id: string | null
  variant: string | null
  files: DocFile[] | null
  file_url: string | null
  expires_at: string | null
  status: DocStatus
  validated_at: string | null
  note: string | null
}

type Row = {
  id: string
  name: string
  email: string | null
  phone: string | null
  documents: Doc[]
}

type Type = { id: string; name: string; required: boolean; has_expiry: boolean }

// Stato di un documento per una certa allieva: manca / da validare / valido / …
const CHIP: Record<string, string> = {
  missing: 'bg-gray-100 text-gray-400',
  pending: 'bg-amber-100 text-amber-700',
  valid: 'bg-green-100 text-green-700',
  expiring: 'bg-yellow-100 text-yellow-700',
  expired: 'bg-red-100 text-red-600',
}

export default function SchoolDocumentsPage() {
  const t = useTranslations('school.documents')

  const [rows, setRows] = useState<Row[]>([])
  const [types, setTypes] = useState<Type[]>([])
  const [loading, setLoading] = useState(true)
  // Regola piattaforma: i filtri sono sempre a selezione multipla
  const [filterStatus, setFilterStatus] = useState<string[]>([])
  const [filterTypes, setFilterTypes] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [sheetStudent, setSheetStudent] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/school/documents', { cache: 'no-store' })
    if (res.ok) {
      const data = await res.json()
      setRows(data.students ?? [])
      setTypes(data.types ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Stato di una allieva su un tipo di documento
  const stateOf = (row: Row, type: Type) => {
    const doc = row.documents.find(d => d.type_id === type.id)
    if (!doc) return 'missing'
    if (!doc.validated_at) return 'pending'
    return doc.status
  }

  const counts = {
    pending: rows.filter(r => types.some(ty => stateOf(r, ty) === 'pending')).length,
    expiring: rows.filter(r => types.some(ty => stateOf(r, ty) === 'expiring')).length,
    expired: rows.filter(r => types.some(ty => stateOf(r, ty) === 'expired')).length,
    missing: rows.filter(r => types.some(ty => ty.required && stateOf(r, ty) === 'missing')).length,
  }

  const query = search.trim().toLowerCase()
  const filtered = rows.filter(row => {
    if (query) {
      const haystack = `${row.name} ${row.email ?? ''} ${row.phone ?? ''}`.toLowerCase()
      if (!haystack.includes(query)) return false
    }
    // I due filtri si combinano: lo stato vale sui tipi selezionati
    const relevant = filterTypes.length ? types.filter(ty => filterTypes.includes(ty.id)) : types
    if (filterTypes.length && relevant.length === 0) return false
    if (filterStatus.length) {
      return relevant.some(ty => filterStatus.includes(stateOf(row, ty)))
    }
    return true
  })

  const filtersActive = filterStatus.length > 0 || filterTypes.length > 0 || !!search

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-gray-500 text-sm mt-0.5">{t('subtitle')}</p>
      </div>

      {/* Riepilogo: quante allieve hanno qualcosa da sistemare */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {([
          ['pending', t('pendingValidation'), counts.pending, 'text-amber-600', 'border-amber-400 ring-amber-200'],
          ['expiring', t('expiringSoon'), counts.expiring, 'text-yellow-600', 'border-yellow-400 ring-yellow-200'],
          ['expired', t('expired'), counts.expired, 'text-red-600', 'border-red-400 ring-red-200'],
          ['missing', t('missingRequired'), counts.missing, 'text-gray-900', 'border-gray-400 ring-gray-300'],
        ] as const).map(([key, label, value, color, active]) => (
          <button
            key={key}
            onClick={() => setFilterStatus(prev => prev.includes(key) ? prev.filter(v => v !== key) : [...prev, key])}
            className={`text-left bg-white rounded-xl border p-5 transition ${filterStatus.includes(key) ? `${active} ring-1` : 'border-gray-100 hover:border-gray-300'}`}
          >
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <MultiSelectFilter
          label={t('filterStatus')}
          selected={filterStatus}
          onChange={setFilterStatus}
          options={[
            { value: 'missing', label: t('statusMissing') },
            { value: 'pending', label: t('pendingValidation') },
            { value: 'valid', label: t('valid') },
            { value: 'expiring', label: t('expiring') },
            { value: 'expired', label: t('expired') },
          ]}
        />
        <MultiSelectFilter
          label={t('filterType')}
          selected={filterTypes}
          onChange={setFilterTypes}
          options={types.map(ty => ({ value: ty.id, label: ty.name }))}
        />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('searchStudent')}
          className="flex-1 min-w-56 max-w-sm px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
        />
        {filtersActive && (
          <button
            onClick={() => { setFilterStatus([]); setFilterTypes([]); setSearch('') }}
            className="text-xs text-gray-400 hover:text-gray-700 transition"
          >
            {t('clearFilters')}
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">{t('loading')}</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">{t('noStudents')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('colStudent')}</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('colContacts')}</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('colDocuments')}</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(row => (
                <tr key={row.id} className="hover:bg-gray-50 transition align-top">
                  <td className="px-6 py-3">
                    <button onClick={() => setSheetStudent(row.id)} className="text-left group">
                      <p className="font-medium text-gray-900 group-hover:text-[#6B1F3A] group-hover:underline">{row.name}</p>
                    </button>
                  </td>

                  <td className="px-6 py-3 text-gray-500">
                    <p className="text-xs">{row.email ?? '—'}</p>
                    <p className="text-xs text-gray-400">{row.phone ?? '—'}</p>
                  </td>

                  {/* Una pastiglia per documento richiesto, con scadenza se c'è */}
                  <td className="px-6 py-3">
                    {types.length === 0 ? (
                      <span className="text-xs text-gray-300">{t('noTypesConfigured')}</span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {types.map(ty => {
                          const state = stateOf(row, ty)
                          const doc = row.documents.find(d => d.type_id === ty.id)
                          return (
                            <span key={ty.id} className={`text-xs px-2 py-0.5 rounded-full ${CHIP[state]}`}>
                              {ty.name}
                              {ty.required && state === 'missing' && ' *'}
                              {doc?.expires_at && (state === 'expiring' || state === 'expired') && (
                                <span className="ml-1 opacity-80">
                                  {new Date(doc.expires_at).toLocaleDateString('it', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                                </span>
                              )}
                            </span>
                          )
                        })}
                      </div>
                    )}
                  </td>

                  <td className="px-6 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => setSheetStudent(row.id)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition"
                    >
                      {t('openSheet')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Stessa scheda a due tab usata in Allieve */}
      {sheetStudent && (
        <StudentSheet
          studentId={sheetStudent}
          editable
          initialTab="documents"
          onClose={() => setSheetStudent(null)}
          onChanged={load}
        />
      )}
    </div>
  )
}
