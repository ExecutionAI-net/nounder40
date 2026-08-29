'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { apiFetch, ApiError } from '@/lib/api/client'

interface School { id: string; name: string; city: string; country: string; country_code?: string | null }

interface Props {
  open: boolean
  currentSchoolId?: string | null
  onSaved: (school: School) => void
}

export default function SchoolSelectModal({ open, currentSchoolId, onSaved }: Props) {
  const t = useTranslations('schoolSelect')
  const locale = useLocale()
  // Il paese arriva come codice ISO: il nome lo scrive il browser nella lingua
  // di chi guarda. `country` e' testo libero e mostrava "Milano, Italy" a
  // un'italiana e "Aachen, IT" senza nemmeno il nome del paese.
  const regionNames = useMemo(() => {
    try {
      return new Intl.DisplayNames([locale], { type: 'region' })
    } catch {
      return null
    }
  }, [locale])

  function countryLabel(school: School) {
    return (school.country_code && regionNames?.of(school.country_code)) || school.country
  }

  const [schools, setSchools] = useState<School[]>([])
  const [selected, setSelected] = useState<string>(currentSchoolId ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch<School[]>('/schools/public/')
      .then((d) => setSchools(Array.isArray(d) ? d : []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    setSelected(currentSchoolId ?? '')
  }, [currentSchoolId])

  if (!open) return null

  async function handleSave() {
    if (!selected) return
    setSaving(true)
    setError(null)
    try {
      await apiFetch('/student/school/', { method: 'POST', body: JSON.stringify({ school_id: selected }) })
      const school = schools.find(s => s.id === selected)!
      onSaved(school)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('saveFailed'))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900 text-lg">
            {currentSchoolId ? t('titleChange') : t('titleChoose')}
          </h3>
          <p className="text-sm text-gray-400 mt-0.5">
            {currentSchoolId
              ? t('subtitleChange')
              : t('subtitleChoose')}
          </p>
        </div>

        <div className="px-6 py-4">
          {error && <div className="mb-3 p-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}

          {schools.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">{t('loading')}</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {schools.map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelected(s.id)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition ${
                    selected === s.id
                      ? 'border-brand bg-brand/5'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                    selected === s.id ? 'border-brand' : 'border-gray-300'
                  }`}>
                    {selected === s.id && <div className="w-2 h-2 rounded-full bg-brand" />}
                  </div>
                  <div>
                    <p className={`text-sm font-medium ${selected === s.id ? 'text-brand' : 'text-gray-900'}`}>
                      {s.name}
                    </p>
                    <p className="text-xs text-gray-400">{s.city}, {countryLabel(s)}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={!selected || saving}
            className="mt-4 w-full py-2.5 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand-hover transition disabled:opacity-50"
          >
            {saving ? t('saving') : t('confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
