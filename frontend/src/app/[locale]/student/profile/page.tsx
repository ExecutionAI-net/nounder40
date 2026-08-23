'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/api/auth-context'
import { apiFetch } from '@/lib/api/client'
import StudentProfileFields from '@/components/students/StudentProfileFields'
import StudentDocumentsPanel, { type PanelDoc, type PanelSchool } from '@/components/students/StudentDocumentsPanel'
import SchoolSelectModal from '@/components/SchoolSelectModal'
import { useTranslations } from 'next-intl'

type HQCountry = { id: string; name: string; code: string; cities: { id: string; name: string }[] }
type HQCity = { id: string; country_id: string; name: string }

interface Profile {
  name: string
  email: string
  phone: string | null
  date_of_birth: string | null
  address: string | null
  city: string | null
  country: string | null
  language_preference: string
}

interface School { id: string; name: string; city: string; country: string }

export default function StudentProfilePage() {
  const t = useTranslations('student.profile')
  const { user, loading: authLoading } = useAuth()
  const [tab, setTab] = useState<'profile' | 'documents'>('profile')

  const [hqCountries, setHqCountries] = useState<HQCountry[]>([])
  const [hqCities, setHqCities] = useState<HQCity[]>([])

  const [form, setForm] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentSchool, setCurrentSchool] = useState<School | null>(null)
  const [schoolModalOpen, setSchoolModalOpen] = useState(false)

  const [docs, setDocs] = useState<PanelDoc[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [docSchools, setDocSchools] = useState<PanelSchool[]>([])

  useEffect(() => {
    if (!user) return
    apiFetch<{ school: School | null }>('/student/school/')
      .then((d) => setCurrentSchool(d.school))
      .catch(() => {})
  }, [user])

  useEffect(() => {
    apiFetch<HQCountry[]>('/locations/')
      .then((countries) => {
        setHqCountries(countries)
        setHqCities(countries.flatMap((c) => c.cities.map((city) => ({ ...city, country_id: c.id }))))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!user) return
    apiFetch<Profile>('/student/profile/')
      .then((data) => setForm(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [user])

  async function loadDocs() {
    if (!currentSchool) {
      setDocs([])
      setDocSchools([])
      return
    }
    setDocsLoading(true)
    try {
      const [documents, types] = await Promise.all([
        apiFetch<Array<Record<string, unknown>>>('/student/documents/'),
        apiFetch<Array<{ id: string; name: string; variants: string[]; has_expiry: boolean; required: boolean }>>(
          `/schools/${currentSchool.id}/document-types/`
        ),
      ])
      setDocs(
        documents.map((d) => ({
          id: d.id as string, school_id: d.school as string, type_id: (d.type_ref as string | null) ?? null,
          variant: d.variant as string | null, files: d.files as PanelDoc['files'],
          file_url: d.file_url as string | null, expires_at: d.expires_at as string | null,
          status: d.status as PanelDoc['status'], validated_at: d.validated_at as string | null,
          note: d.note as string | null,
        }))
      )
      setDocSchools([{ id: currentSchool.id, name: currentSchool.name, types }])
    } catch (e) {
      console.error('[profile/documents] load error:', e)
    }
    setDocsLoading(false)
  }

  useEffect(() => {
    if (tab === 'documents') loadDocs()
  }, [tab, currentSchool]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    if (!form) return
    setSaving(true)
    setError(null)
    setSuccess(false)

    try {
      await apiFetch('/student/profile/', {
        method: 'PATCH',
        body: JSON.stringify({
          name: form.name, phone: form.phone, date_of_birth: form.date_of_birth || null,
          address: form.address, city: form.city, country: form.country,
          language_preference: form.language_preference,
        }),
      })
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    }
    setSaving(false)
  }

  if (authLoading || loading || !form) {
    return <div className="animate-pulse h-8 bg-gray-100 rounded w-48" />
  }

  const profileTabs = [
    { key: 'profile' as const, label: t('tabProfile') },
    { key: 'documents' as const, label: t('tabDocuments') },
  ]

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">{t('title')}</h1>

      <div className="flex gap-1 mb-6 border-b border-gray-100">
        {profileTabs.map(tb => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={`px-4 py-2 text-sm font-medium capitalize transition border-b-2 -mb-px ${
              tab === tb.key ? 'border-brand text-brand' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <>
          <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
            <StudentProfileFields
              value={form}
              onChange={next => setForm({ ...form, ...next })}
              countries={hqCountries}
              cities={hqCities}
            />

            {error && <p className="text-red-600 text-sm">{error}</p>}
            {success && <p className="text-green-600 text-sm">{t('profileUpdated')}</p>}

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-brand text-white rounded-lg py-2.5 text-sm font-medium hover:bg-brand-hover transition disabled:opacity-50"
            >
              {saving ? t('saving') : t('saveChanges')}
            </button>
          </div>

          {/* School */}
          <div className="bg-white rounded-xl border border-gray-100 p-6 mt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700">{t('mySchool')}</p>
                {currentSchool ? (
                  <p className="text-sm text-gray-500 mt-0.5">{currentSchool.name} — {currentSchool.city}</p>
                ) : (
                  <p className="text-sm text-gray-400 mt-0.5">{t('noSchoolSelected')}</p>
                )}
              </div>
              <button
                onClick={() => setSchoolModalOpen(true)}
                className="text-sm text-brand font-medium hover:underline"
              >
                {currentSchool ? t('changeSchool') : t('selectSchool')}
              </button>
            </div>
          </div>

          <SchoolSelectModal
            open={schoolModalOpen}
            currentSchoolId={currentSchool?.id}
            onSaved={(school) => { setCurrentSchool(school); setSchoolModalOpen(false) }}
          />
        </>
      )}

      {tab === 'documents' && (
        docsLoading ? (
          <div className="text-sm text-gray-400 py-8 text-center">{t('loading')}</div>
        ) : (
          <StudentDocumentsPanel
            schools={docSchools}
            documents={docs}
            onReload={loadDocs}
          />
        )
      )}

    </div>
  )
}
