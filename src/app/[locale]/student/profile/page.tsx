'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import StudentProfileFields from '@/components/students/StudentProfileFields'
import StudentDocumentsPanel, { type PanelDoc } from '@/components/students/StudentDocumentsPanel'
import SchoolSelectModal from '@/components/SchoolSelectModal'
import { useTranslations, useLocale } from 'next-intl'
import PhoneInput from '@/components/ui/PhoneInput'

const LANGUAGES = [
  { value: 'it', label: 'Italiano' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
]

type HQCountry = { id: string; name: string; code: string }
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

interface StudentDoc {
  id: string
  type: string
  type_id: string | null
  variant: string | null
  files: { path: string; name: string }[] | null
  file_url: string | null
  uploaded_at: string | null
  expires_at: string | null
  status: 'valid' | 'expiring' | 'expired'
  validated_at: string | null
  school_id: string
  schools: { name: string } | null
}

// Ogni scuola definisce i propri documenti (Impostazioni → Documenti)
interface DocSchool {
  id: string
  name: string
  types: { id: string; name: string; variants: string[]; has_expiry: boolean; required: boolean }[]
}

export default function StudentProfilePage() {
  const t = useTranslations('student.profile')
  const uiLocale = useLocale()
  const supabase = createClient()
  const [tab, setTab] = useState<'profile' | 'documents'>('profile')

  const [hqCountries, setHqCountries] = useState<HQCountry[]>([])
  const [hqCities, setHqCities] = useState<HQCity[]>([])

  const [profile, setProfile] = useState<Profile | null>(null)
  const [form, setForm] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentSchool, setCurrentSchool] = useState<School | null>(null)
  const [schoolModalOpen, setSchoolModalOpen] = useState(false)

  const [docs, setDocs] = useState<PanelDoc[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [docSchools, setDocSchools] = useState<DocSchool[]>([])

  const DOC_LABELS: Record<string, string> = {
    medical_cert: t('docMedicalCert'),
    privacy: t('docPrivacy'),
    image_release: t('docImageRelease'),
  }

  useEffect(() => {
    fetch('/api/student/school', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setCurrentSchool(d.school ?? null))
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/locations', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { setHqCountries(d.countries ?? []); setHqCities(d.cities ?? []) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profileData } = await supabase
        .from('profiles')
        .select('name, city')
        .eq('id', user.id)
        .single()

      let { data: student } = await supabase
        .from('students')
        .select('name, phone, date_of_birth, address, city, country, language_preference')
        .eq('user_id', user.id)
        .maybeSingle()

      if (!student) {
        const meta = user.user_metadata ?? {}
        const name = meta.name ?? profileData?.name ?? user.email!.split('@')[0]
        let detectedLanguage = 'en'
        try {
          const langRes = await fetch('/api/student/detect-language', { cache: 'no-store' })
          if (langRes.ok) {
            const langData = await langRes.json()
            detectedLanguage = langData.language ?? 'en'
          }
        } catch { /* fallback to 'en' */ }
        const { error: insertErr } = await supabase.from('students').insert({
          user_id: user.id,
          name,
          email: user.email!,
          phone: meta.phone ?? null,
          date_of_birth: meta.date_of_birth ?? null,
          city: meta.city ?? null,
          country: meta.country ?? null,
          language_preference: detectedLanguage,
        })
        if (insertErr) {
          console.error('[profile] student insert error:', insertErr.message)
        } else {
          const { data: newStudent } = await supabase
            .from('students')
            .select('name, phone, date_of_birth, address, city, country')
            .eq('user_id', user.id)
            .maybeSingle()
          student = newStudent
        }
      }

      const merged: Profile = {
        name: student?.name ?? profileData?.name ?? '',
        email: user.email ?? '',
        phone: student?.phone ?? null,
        date_of_birth: student?.date_of_birth ?? null,
        address: student?.address ?? null,
        city: student?.city ?? profileData?.city ?? null,
        country: student?.country ?? null,
        language_preference: student?.language_preference ?? 'en',
      }
      setProfile(merged)
      setForm(merged)
      setLoading(false)
    }
    load()
  }, [supabase]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadDocs() {
    setDocsLoading(true)
    try {
      const res = await fetch('/api/student/documents', { cache: 'no-store' })
      const data = await res.json()
      setDocs(Array.isArray(data.documents) ? data.documents : [])
      setDocSchools(Array.isArray(data.schools) ? data.schools : [])
    } catch (e) {
      console.error('[profile/documents] load error:', e)
    }
    setDocsLoading(false)
  }

  useEffect(() => {
    if (tab === 'documents') loadDocs()
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    if (!form) return
    setSaving(true)
    setError(null)
    setSuccess(false)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    await supabase
      .from('profiles')
      .update({ name: form.name, city: form.city })
      .eq('id', user.id)

    const { error: err } = await supabase
      .from('students')
      .upsert({
        user_id: user.id,
        name: form.name,
        email: form.email,
        phone: form.phone,
        date_of_birth: form.date_of_birth || null,
        address: form.address,
        city: form.city,
        country: form.country,
        language_preference: form.language_preference,
      }, { onConflict: 'user_id' })

    if (err) {
      setError(err.message)
    } else {
      setSuccess(true)
      setProfile(form)
    }
    setSaving(false)
  }

  if (loading || !form) {
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
