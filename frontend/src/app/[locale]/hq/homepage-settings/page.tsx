'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { apiFetch, ApiError } from '@/lib/api/client'

export default function HomepageSettingsPage() {
  const t = useTranslations('hq.homepage-settings')
  const [form, setForm] = useState({ teachers: '', students: '', lessonsMonthly: '', schools: '' })
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [success, setSuccess]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => {
    apiFetch<Record<string, string>>('/hq/homepage-settings/')
      .then(d => {
        setForm({
          teachers:       d.stat_teachers        ?? '20',
          students:       d.stat_students        ?? '249',
          lessonsMonthly: d.stat_lessons_monthly ?? '950',
          schools:        d.stat_schools         ?? '3',
        })
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(false)

    try {
      await apiFetch('/hq/homepage-settings/', { method: 'POST', body: JSON.stringify(form) })
      setSuccess(true)
    } catch (err) {
      const body = err instanceof ApiError ? err.body as { error?: string } : null
      setError(body?.error ?? t('errorFailed'))
    }
    setSaving(false)
  }

  if (loading) return <div className="text-sm text-gray-400">{t('loading')}</div>

  const fields = [
    { key: 'schools'        as const, label: t('labelSchools') },
    { key: 'teachers'       as const, label: t('labelTeachers') },
    { key: 'students'       as const, label: t('labelStudents') },
    { key: 'lessonsMonthly' as const, label: t('labelLessonsMonthly') },
  ]

  return (
    <div className="max-w-lg">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-gray-500 text-sm mt-1">{t('subtitle')}</p>
      </div>

      <form onSubmit={handleSave} className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
        {success && <div className="p-3 bg-green-50 text-green-700 text-sm rounded-lg">{t('successSaved')}</div>}
        {error   && <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}

        {fields.map(f => (
          <div key={f.key}>
            <label className="block text-sm font-medium text-gray-700 mb-1">{f.label}</label>
            <input
              type="number"
              min="0"
              value={form[f.key]}
              onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]"
            />
          </div>
        ))}

        <div className="pt-2 flex gap-3">
          <button type="submit" disabled={saving}
            className="flex-1 py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50">
            {saving ? t('buttonSaving') : t('buttonSave')}
          </button>
          <Link href="/" target="_blank"
            className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition">
            {t('buttonPreview')}
          </Link>
        </div>
      </form>
    </div>
  )
}
