'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import ImageUploadInput from '@/components/ui/ImageUploadInput'
import ErrorBanner from '@/components/ui/ErrorBanner'

type SchoolRow = { schools: { name: string; city: string } | null; compensation_plans: { name: string } | null }

export default function TeacherProfilePage() {
  const t = useTranslations('teacher.profile')
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [form, setForm] = useState({ email: '', phone: '', bio: '' })
  const [schools, setSchools] = useState<SchoolRow[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: teacher } = await supabase
        .from('teachers')
        .select('id, name, email, phone, bio, photo_url')
        .eq('user_id', user.id)
        .maybeSingle()
      if (teacher) {
        setName(teacher.name ?? '')
        setPhotoUrl(teacher.photo_url ?? null)
        setForm({ email: teacher.email ?? user.email ?? '', phone: teacher.phone ?? '', bio: teacher.bio ?? '' })
        const { data: rows } = await supabase
          .from('teacher_schools')
          .select('schools(name, city), compensation_plans(name)')
          .eq('teacher_id', teacher.id)
          .eq('active', true)
        setSchools((rows ?? []) as unknown as SchoolRow[])
      }
      setLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSaved(false)
    const res = await fetch('/api/teacher/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (res.ok) setSaved(true)
    else {
      const d = await res.json().catch(() => ({}))
      setError(d.error === 'invalid_email' ? t('errorEmail') : d.error ?? t('errorGeneric'))
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
        <div>
          <p className="text-xs text-gray-400 mb-0.5">{t('labelName')}</p>
          <p className="text-sm font-medium text-gray-900">{name || '—'}</p>
          <p className="text-xs text-gray-300 mt-0.5">{t('nameHint')}</p>
        </div>

        {/* La foto e i contatti aggiornano la scheda vista dalla scuola */}
        <ImageUploadInput
          endpoint="/api/teacher/profile"
          imageUrl={photoUrl}
          onChange={setPhotoUrl}
          label={t('labelPhoto')}
        />

        <div>
          <label className="block text-xs text-gray-400 mb-1">{t('labelEmail')}</label>
          <input type="email" value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            className={inputCls} />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">{t('labelPhone')}</label>
          <input value={form.phone}
            onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
            className={inputCls} placeholder="+39 …" />
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

      {schools.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{t('labelSchools')}</h2>
          <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
            {schools.map((s, i) => (
              <div key={i} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{s.schools?.name}</p>
                  <p className="text-xs text-gray-400">{s.schools?.city}</p>
                </div>
                {s.compensation_plans && (
                  <span className="text-xs text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">
                    {s.compensation_plans.name}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
