'use client'

import { useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import DocumentTypesManager from '@/components/school/DocumentTypesManager'
import { apiFetch } from '@/lib/api/client'

const LANGUAGES = [
  { value: 'it', label: 'Italiano' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
]

type Settings = {
  cancellation_policy_hours: number
  grace_period_days: number
  show_teacher_to_students: boolean
  free_first_lesson: boolean
  min_booking_notice_hours: number
  language: string
  /** Documento obbligatorio scaduto o mancante: bloccare la prenotazione */
  block_booking_on_documents: boolean
}

type Closure = {
  id: string
  date: string
  end_date: string | null
  notes: string | null
}

function fmtDate(iso: string, uiLocale: string) {
  return new Date(iso + 'T12:00:00').toLocaleDateString(uiLocale, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })
}

export default function SchoolSettingsPage() {
  const t = useTranslations('school.settings')
  const uiLocale = useLocale()
  const [settings, setSettings] = useState<Settings>({
    cancellation_policy_hours: 24,
    grace_period_days: 7,
    free_first_lesson: false,
    min_booking_notice_hours: 2,
    language: 'it',
    show_teacher_to_students: true,
    block_booking_on_documents: false,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Closure days
  const [closures, setClosures] = useState<Closure[]>([])
  const [newClosure, setNewClosure] = useState({ date: '', end_date: '', notes: '' })
  const [addingClosure, setAddingClosure] = useState(false)

  useEffect(() => {
    async function load() {
      const [school, cls] = await Promise.all([
        apiFetch<Settings>('/school/profile/').catch(() => null),
        apiFetch<Closure[]>('/school/closures/').catch(() => []),
      ])
      if (school) {
        setSettings({
          cancellation_policy_hours: school.cancellation_policy_hours ?? 24,
          grace_period_days: school.grace_period_days ?? 7,
          free_first_lesson: school.free_first_lesson ?? false,
          min_booking_notice_hours: school.min_booking_notice_hours ?? 2,
          language: school.language ?? 'it',
          show_teacher_to_students: school.show_teacher_to_students ?? true,
          block_booking_on_documents: school.block_booking_on_documents ?? false,
        })
      }
      setClosures([...cls].sort((a, b) => a.date.localeCompare(b.date)))
      setLoading(false)
    }
    load()
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await apiFetch('/school/profile/', {
      method: 'PATCH',
      body: JSON.stringify({
        cancellation_policy_hours: settings.cancellation_policy_hours,
        grace_period_days: settings.grace_period_days,
        free_first_lesson: settings.free_first_lesson,
        min_booking_notice_hours: settings.min_booking_notice_hours,
        language: settings.language,
        show_teacher_to_students: settings.show_teacher_to_students,
      }),
    }).catch(() => {})
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  async function saveDocumentBlock(value: boolean) {
    setSettings(s => ({ ...s, block_booking_on_documents: value }))
    await apiFetch('/school/profile/', {
      method: 'PATCH',
      body: JSON.stringify({ block_booking_on_documents: value }),
    }).catch(() => {})
  }

  async function addClosure() {
    if (!newClosure.date) return
    setAddingClosure(true)

    // end_date must be >= date
    const endDate = newClosure.end_date && newClosure.end_date >= newClosure.date
      ? newClosure.end_date
      : null

    try {
      const data = await apiFetch<Closure>('/school/closures/', {
        method: 'POST',
        body: JSON.stringify({ date: newClosure.date, end_date: endDate, type: 'full_day', notes: newClosure.notes || '' }),
      })
      setClosures((c) => [...c, data].sort((a, b) => a.date.localeCompare(b.date)))
      setNewClosure({ date: '', end_date: '', notes: '' })
    } catch {
      // no-op
    }
    setAddingClosure(false)
  }

  async function deleteClosure(id: string) {
    await apiFetch(`/school/closures/${id}/`, { method: 'DELETE' }).catch(() => {})
    setClosures((c) => c.filter((x) => x.id !== id))
  }

  if (loading) return <div className="text-sm text-gray-400">{t('loading')}</div>

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-gray-500 text-sm mt-1">{t('subtitle')}</p>
      </div>

      {/* Operational Settings */}
      <form onSubmit={handleSave} className="bg-white rounded-xl border border-gray-100 p-6 space-y-5">
        <h2 className="font-semibold text-gray-900">{t('operationalRules')}</h2>

        {saved && (
          <div className="p-3 bg-green-50 text-green-700 rounded-lg text-sm">{t('settingsSaved')}</div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('cancellationPolicy')}
            </label>
            <input
              type="number"
              min={0}
              value={settings.cancellation_policy_hours}
              onChange={(e) => setSettings((s) => ({ ...s, cancellation_policy_hours: Number(e.target.value) }))}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
            />
            <p className="text-xs text-gray-400 mt-1">{t('cancellationPolicyHelp')}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('gracePeriod')}
            </label>
            <input
              type="number"
              min={0}
              max={30}
              value={settings.grace_period_days}
              onChange={(e) => setSettings((s) => ({ ...s, grace_period_days: Number(e.target.value) }))}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
            />
            <p className="text-xs text-gray-400 mt-1">{t('gracePeriodHelp')}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('minBookingNotice')}
            </label>
            <input
              type="number"
              min={0}
              value={settings.min_booking_notice_hours}
              onChange={(e) => setSettings((s) => ({ ...s, min_booking_notice_hours: Number(e.target.value) }))}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
            />
            <p className="text-xs text-gray-400 mt-1">{t('minBookingNoticeHelp')}</p>
          </div>

          <div className="flex flex-col justify-center">
            <label className="flex items-center gap-3 cursor-pointer">
              <div className="relative">
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={settings.free_first_lesson}
                  onChange={(e) => setSettings((s) => ({ ...s, free_first_lesson: e.target.checked }))}
                />
                <div className={`w-10 h-6 rounded-full transition ${settings.free_first_lesson ? 'bg-[#6B1F3A]' : 'bg-gray-200'}`} />
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${settings.free_first_lesson ? 'left-5' : 'left-1'}`} />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700">{t('freeFirstLesson')}</p>
                <p className="text-xs text-gray-400">{t('freeFirstLessonDesc')}</p>
              </div>
            </label>
          </div>

          {/* Mostra/nascondi insegnante alle allieve */}
          <div className="flex flex-col justify-center">
            <label className="flex items-center gap-3 cursor-pointer">
              <div className="relative">
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={settings.show_teacher_to_students}
                  onChange={(e) => setSettings((s) => ({ ...s, show_teacher_to_students: e.target.checked }))}
                />
                <div className={`w-10 h-6 rounded-full transition ${settings.show_teacher_to_students ? 'bg-[#6B1F3A]' : 'bg-gray-200'}`} />
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${settings.show_teacher_to_students ? 'left-5' : 'left-1'}`} />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700">{t('showTeacher')}</p>
                <p className="text-xs text-gray-400">{t('showTeacherDesc')}</p>
              </div>
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('schoolLanguage')}
            </label>
            <select
              value={settings.language}
              onChange={(e) => setSettings((s) => ({ ...s, language: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
            >
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">{t('schoolLanguageHelp')}</p>
          </div>
        </div>

        <div className="pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
          >
            {saving ? t('saving') : t('saveSettings')}
          </button>
        </div>
      </form>

      {/* Documenti richiesti alle allieve */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900">{t('documentsTitle')}</h2>
          <p className="text-sm text-gray-500 mt-1">{t('documentsDesc')}</p>
        </div>

        <label className="flex items-start gap-3 p-3 rounded-xl border border-gray-100 bg-gray-50">
          <input
            type="checkbox"
            checked={settings.block_booking_on_documents}
            onChange={(e) => saveDocumentBlock(e.target.checked)}
            className="mt-0.5 accent-[#6B1F3A]"
          />
          <span>
            <span className="block text-sm font-medium text-gray-800">{t('blockBooking')}</span>
            <span className="block text-xs text-gray-500 mt-0.5">{t('blockBookingHelp')}</span>
          </span>
        </label>

        <DocumentTypesManager />
      </div>

      {/* Closure Days */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
        <h2 className="font-semibold text-gray-900">{t('closureDays')}</h2>
        <p className="text-sm text-gray-500">{t('closureDaysDesc')}</p>

        {/* Add form */}
        <div className="space-y-3 p-4 bg-gray-50 rounded-xl border border-gray-100">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('from')}</label>
              <input
                type="date"
                value={newClosure.date}
                onChange={(e) => setNewClosure((c) => ({ ...c, date: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('to')}</label>
              <input
                type="date"
                value={newClosure.end_date}
                min={newClosure.date || undefined}
                onChange={(e) => setNewClosure((c) => ({ ...c, end_date: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 bg-white"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder={t('notePlaceholder')}
              value={newClosure.notes}
              onChange={(e) => setNewClosure((c) => ({ ...c, notes: e.target.value }))}
              className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 bg-white"
            />
            <button
              onClick={addClosure}
              disabled={addingClosure || !newClosure.date}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium disabled:opacity-50 whitespace-nowrap"
            >
              {addingClosure ? t('adding') : t('addBtn')}
            </button>
          </div>
        </div>

        {/* List */}
        {closures.length > 0 ? (
          <div className="space-y-2">
            {closures.map((c) => {
              const isRange = c.end_date && c.end_date !== c.date
              return (
                <div key={c.id} className="flex items-center justify-between bg-amber-50 border border-amber-100 rounded-lg px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                    <div>
                      <span className="text-sm font-medium text-gray-800">
                        {isRange
                          ? `${fmtDate(c.date, uiLocale)} → ${fmtDate(c.end_date!, uiLocale)}`
                          : fmtDate(c.date, uiLocale)
                        }
                      </span>
                      {c.notes && (
                        <span className="block text-xs text-amber-700 mt-0.5">{c.notes}</span>
                      )}
                    </div>
                  </div>
                  <button onClick={() => deleteClosure(c.id)} className="text-xs text-red-400 hover:text-red-600 ml-4 shrink-0">
                    {t('remove')}
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-gray-400">{t('noClosureDays')}</p>
        )}
      </div>
    </div>
  )
}
