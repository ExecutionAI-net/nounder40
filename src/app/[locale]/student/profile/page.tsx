'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import SchoolSelectModal from '@/components/SchoolSelectModal'
import { useTranslations } from 'next-intl'
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
  type: 'medical_cert' | 'privacy' | 'image_release'
  file_url: string | null
  uploaded_at: string | null
  expires_at: string | null
  status: 'valid' | 'expiring' | 'expired'
  validated_at: string | null
  school_id: string
  schools: { name: string } | null
}

const DOC_TYPES = ['medical_cert', 'privacy', 'image_release'] as const

const STATUS_COLORS: Record<string, string> = {
  valid: 'bg-green-100 text-green-700',
  expiring: 'bg-yellow-100 text-yellow-700',
  expired: 'bg-red-100 text-red-600',
}

export default function StudentProfilePage() {
  const t = useTranslations('student.profile')
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

  const [docs, setDocs] = useState<StudentDoc[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [enrolledSchools, setEnrolledSchools] = useState<{ id: string; name: string }[]>([])
  const [uploading, setUploading] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pendingUpload, setPendingUpload] = useState<{ schoolId: string; type: string } | null>(null)

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
      setDocs(Array.isArray(data) ? data : [])

      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: enrollments } = await supabase
          .from('school_students')
          .select('school_id, schools(id, name)')
          .eq('student_id', user.id)
        const schools = (enrollments ?? []).map((e: { school_id: string; schools: { id: string; name: string } | null }) => ({
          id: e.school_id,
          name: (e.schools as { name: string } | null)?.name ?? e.school_id,
        }))
        setEnrolledSchools(schools)
      }
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

  function triggerUpload(schoolId: string, type: string) {
    setPendingUpload({ schoolId, type })
    setUploadError(null)
    fileInputRef.current?.click()
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !pendingUpload) return

    const { schoolId, type } = pendingUpload
    const key = `${schoolId}-${type}`
    setUploading(key)
    setUploadError(null)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const ext = file.name.split('.').pop()
      const path = `${user.id}/${schoolId}/${type}-${Date.now()}.${ext}`

      const { error: uploadErr } = await supabase.storage
        .from('documents')
        .upload(path, file, { upsert: true })

      if (uploadErr) throw uploadErr

      const { data: urlData } = supabase.storage.from('documents').getPublicUrl(path)
      const file_url = urlData.publicUrl

      const res = await fetch('/api/student/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ school_id: schoolId, type, file_url }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error ?? t('uploadFailed'))

      await loadDocs()
    } catch (err: unknown) {
      console.error('[documents] upload error:', err)
      setUploadError(err instanceof Error ? err.message : t('uploadFailed'))
    }

    setUploading(null)
    setPendingUpload(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
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
              tab === tb.key ? 'border-[#6B1F3A] text-[#6B1F3A]' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <>
          <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('fullName')}</label>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('email')}</label>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-400"
                value={form.email}
                disabled
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('phone')}</label>
              <PhoneInput
                inputClassName="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                value={form.phone ?? ''}
                onChange={phone => setForm({ ...form, phone })}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('dateOfBirth')}</label>
              <input
                type="date"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                value={form.date_of_birth ?? ''}
                onChange={e => setForm({ ...form, date_of_birth: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('address')}</label>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                value={form.address ?? ''}
                onChange={e => setForm({ ...form, address: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('country')}</label>
                {hqCountries.length === 0 ? (
                  <input
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                    value={form.country ?? ''}
                    onChange={e => setForm({ ...form, country: e.target.value })}
                  />
                ) : (
                  <select
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
                    value={form.country ?? ''}
                    onChange={e => setForm({ ...form, country: e.target.value, city: '' })}
                  >
                    <option value="">{t('selectCountry')}</option>
                    {hqCountries.map((c) => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('city')}</label>
                {hqCountries.length === 0 ? (
                  <input
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                    value={form.city ?? ''}
                    onChange={e => setForm({ ...form, city: e.target.value })}
                  />
                ) : (() => {
                  const matchedCountry = hqCountries.find((c) => c.name === form.country)
                  const filteredCities = matchedCountry
                    ? hqCities.filter((c) => c.country_id === matchedCountry.id)
                    : []
                  return (
                    <select
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white disabled:opacity-50 disabled:cursor-not-allowed"
                      value={form.city ?? ''}
                      onChange={e => setForm({ ...form, city: e.target.value })}
                      disabled={!form.country || filteredCities.length === 0}
                    >
                      {!form.country ? (
                        <option value="">{t('selectCountryFirst')}</option>
                      ) : filteredCities.length === 0 ? (
                        <option value="">{t('noCitiesAvailable')}</option>
                      ) : (
                        <>
                          <option value="">{t('selectCity')}</option>
                          {filteredCities.map((c) => (
                            <option key={c.id} value={c.name}>{c.name}</option>
                          ))}
                        </>
                      )}
                    </select>
                  )
                })()}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('language')}</label>
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                value={form.language_preference}
                onChange={e => setForm({ ...form, language_preference: e.target.value })}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">{t('languageHint')}</p>
            </div>

            {error && <p className="text-red-600 text-sm">{error}</p>}
            {success && <p className="text-green-600 text-sm">{t('profileUpdated')}</p>}

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-[#6B1F3A] text-white rounded-lg py-2.5 text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
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
                className="text-sm text-[#6B1F3A] font-medium hover:underline"
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
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            className="hidden"
            onChange={handleFileChange}
          />

          {docsLoading ? (
            <div className="text-sm text-gray-400 py-8 text-center">{t('loading')}</div>
          ) : enrolledSchools.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
              {t('notEnrolled')}
            </div>
          ) : (
            <div className="space-y-6">
              {uploadError && (
                <p className="text-red-600 text-sm">{uploadError}</p>
              )}
              {enrolledSchools.map(school => (
                <div key={school.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
                    <p className="text-sm font-medium text-gray-700">{school.name}</p>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {DOC_TYPES.map(type => {
                      const doc = docs.find(d => d.school_id === school.id && d.type === type)
                      const key = `${school.id}-${type}`
                      const isUploading = uploading === key
                      return (
                        <div key={type} className="flex items-center justify-between px-5 py-4">
                          <div>
                            <p className="text-sm font-medium text-gray-800">{DOC_LABELS[type]}</p>
                            {doc ? (
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[doc.status]}`}>
                                  {t(`docStatus.${doc.status}` as Parameters<typeof t>[0])}
                                </span>
                                {doc.expires_at && (
                                  <span className="text-xs text-gray-400">
                                    {t('docExpires', { date: new Date(doc.expires_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) })}
                                  </span>
                                )}
                                {!doc.validated_at && (
                                  <span className="text-xs text-amber-600">{t('pendingReview')}</span>
                                )}
                              </div>
                            ) : (
                              <p className="text-xs text-gray-400 mt-0.5">{t('notUploaded')}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-3">
                            {doc?.file_url && (
                              <a
                                href={doc.file_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-[#6B1F3A] hover:underline"
                              >
                                {t('view')}
                              </a>
                            )}
                            <button
                              onClick={() => triggerUpload(school.id, type)}
                              disabled={isUploading}
                              className="text-xs bg-[#6B1F3A] text-white px-3 py-1.5 rounded-lg hover:bg-[#5a1930] transition disabled:opacity-50"
                            >
                              {isUploading ? t('uploading') : doc ? t('replace') : t('upload')}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
