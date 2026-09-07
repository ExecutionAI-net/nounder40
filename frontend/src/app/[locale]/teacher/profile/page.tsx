'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import ImageUploadInput from '@/components/ui/ImageUploadInput'
import ErrorBanner from '@/components/ui/ErrorBanner'
import PhoneInput from '@/components/ui/PhoneInput'
import { apiFetch, ApiError } from '@/lib/api/client'
import SchoolCard from '@/components/ui/SchoolCard'

type SchoolRow = {
  school_id: string
  school_name: string
  school_city: string | null
}

export default function TeacherProfilePage() {
  const t = useTranslations('teacher.profile')
  const [loading, setLoading] = useState(true)
  const [teacherId, setTeacherId] = useState<string | null>(null)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [form, setForm] = useState({ email: '', phone: '', bio: '' })
  const [schools, setSchools] = useState<SchoolRow[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      type TeacherProfile = { id: string; name: string; first_name: string; last_name: string; email: string; phone: string; bio: string; photo_url: string | null }
      const [teacher, schoolRows] = await Promise.all([
        apiFetch<TeacherProfile>('/teacher/profile/').catch(() => null),
        apiFetch<SchoolRow[]>('/teacher/schools/').catch(() => []),
      ])
      if (teacher) {
        setTeacherId(teacher.id)
        // Fallback per profili vecchi senza campi separati: dividi il nome
        const [head, ...rest] = (teacher.name ?? '').split(' ')
        setFirstName(teacher.first_name || head || '')
        setLastName(teacher.last_name || rest.join(' '))
        setPhotoUrl(teacher.photo_url ?? null)
        setForm({ email: teacher.email ?? '', phone: teacher.phone ?? '', bio: teacher.bio ?? '' })
      }
      setSchools(schoolRows)
      setLoading(false)
    }
    load()
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await apiFetch('/teacher/profile/', { method: 'PATCH', body: JSON.stringify({ first_name: firstName, last_name: lastName, email: form.email, phone: form.phone, bio: form.bio }) })
      setSaved(true)
    } catch (err) {
      const body = err instanceof ApiError ? err.body as { error?: string } : null
      setError(body?.error === 'invalid_email' ? t('errorEmail') : body?.error ?? t('errorGeneric'))
    }
    setSaving(false)
  }

  const inputCls = 'w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20'

  if (loading) return <div className="text-sm text-gray-400">{t('loading')}</div>

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">{t('title')}</h1>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      {saved && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700">{t('saved')}</div>}

      <form onSubmit={handleSave} className="bg-white rounded-xl border border-gray-100 p-6 space-y-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('labelFirstName')}</label>
            <input value={firstName} onChange={e => setFirstName(e.target.value)} required className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('labelLastName')}</label>
            <input value={lastName} onChange={e => setLastName(e.target.value)} className={inputCls} />
          </div>
        </div>

        {/* La foto e i contatti aggiornano la scheda vista dalla scuola */}
        {teacherId && (
          <ImageUploadInput
            endpoint={`/teacher/${teacherId}/image/`}
            imageUrl={photoUrl}
            onChange={setPhotoUrl}
            label={t('labelPhoto')}
          />
        )}

        <div>
          <label className="block text-xs text-gray-400 mb-1">{t('labelEmail')}</label>
          <input type="email" value={form.email} required
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            className={inputCls} />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">{t('labelPhone')}</label>
          <PhoneInput value={form.phone}
            onChange={phone => setForm(f => ({ ...f, phone }))}
            inputClassName={inputCls} />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">{t('labelBio')}</label>
          <textarea value={form.bio} rows={3}
            onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}
            className={`${inputCls} resize-none`} />
        </div>
        <button type="submit" disabled={saving}
          className="w-full py-2.5 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700 transition disabled:opacity-50">
          {saving ? t('saving') : t('save')}
        </button>
        <p className="text-xs text-gray-400">{t('syncHint')}</p>
      </form>

      {/* Stessa card del profilo allieva (SchoolCard). Niente piano di
          compenso qui: non è fisso, cambia da lezione a lezione (scheda
          classe), e la Dashboard ha già la sua sezione. */}
      {schools.length === 1 && (
        <SchoolCard label={t('labelSchool')} name={schools[0].school_name} city={schools[0].school_city} />
      )}
      {schools.length > 1 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{t('labelSchools')}</h2>
          <div className="space-y-2">
            {schools.map((s) => (
              <SchoolCard key={s.school_id} name={s.school_name} city={s.school_city} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
