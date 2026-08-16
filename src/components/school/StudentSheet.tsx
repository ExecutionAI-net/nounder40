'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import StudentProfileFields, { type ProfileFields } from '@/components/students/StudentProfileFields'
import StudentDocumentsPanel, { type PanelDoc, type PanelType } from '@/components/students/StudentDocumentsPanel'

// Scheda allieva vista dalla scuola: identica al profilo dell'allieva
// (stessi componenti, stessi due tab) con in più, sui documenti, la data di
// scadenza e le azioni approva / rifiuta / segnala.
export default function StudentSheet({
  studentId,
  onClose,
  onChanged,
  initialTab = 'profile',
  editable = false,
}: {
  studentId: string
  onClose: () => void
  onChanged?: () => void
  initialTab?: 'profile' | 'documents'
  /** La scuola può correggere l'anagrafica dalla scheda */
  editable?: boolean
}) {
  const t = useTranslations('student.profile')
  const tSheet = useTranslations('school.studentSheet')

  const [tab, setTab] = useState<'profile' | 'documents'>(initialTab)
  const [profile, setProfile] = useState<ProfileFields | null>(null)
  const [name, setName] = useState('')
  const [docs, setDocs] = useState<PanelDoc[]>([])
  const [types, setTypes] = useState<PanelType[]>([])
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/school/students/detail?student_id=${studentId}`, { cache: 'no-store' })
    if (res.ok) {
      const data = await res.json()
      const s = data.student
      setName(s?.name ?? '')
      setUserId(s?.user_id ?? null)
      setProfile(s ? {
        name: s.name ?? '',
        email: s.email ?? '',
        phone: s.phone,
        date_of_birth: s.date_of_birth ? String(s.date_of_birth).slice(0, 10) : null,
        address: s.address,
        city: s.city,
        country: s.country,
        language_preference: s.language_preference ?? 'it',
      } : null)
      setDocs(data.documents ?? [])
      setTypes(data.documentTypes ?? [])
    }
    setLoading(false)
  }, [studentId])

  useEffect(() => { load() }, [load])

  async function handleSave() {
    if (!profile || !userId) return
    setSaving(true)
    setError(null)
    setSaved(false)

    const res = await fetch('/api/school/students', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_user_id: userId,
        name: profile.name,
        phone: profile.phone ?? '',
        email: profile.email,
        date_of_birth: profile.date_of_birth,
        address: profile.address,
        city: profile.city,
        country: profile.country,
        language_preference: profile.language_preference,
      }),
    })

    if (res.ok) {
      setSaved(true)
      setName(profile.name)
      onChanged?.()
      setTimeout(() => setSaved(false), 2500)
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error === 'invalid_email' ? tSheet('invalidEmail') : data.error ?? tSheet('saveFailed'))
    }
    setSaving(false)
  }

  async function reload() {
    await load()
    onChanged?.()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl my-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 truncate">{name || '—'}</h3>
            <p className="text-xs text-gray-400 truncate">{profile?.email}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        {/* Stessi due tab del profilo allieva */}
        <div className="px-6 pt-4">
          <div className="inline-flex bg-gray-100 rounded-xl p-1">
            {(['profile', 'documents'] as const).map(key => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${tab === key ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}
              >
                {key === 'profile' ? t('tabProfile') : t('tabDocuments')}
              </button>
            ))}
          </div>
        </div>

        <div className="p-6">
          {loading || !profile ? (
            <p className="text-sm text-gray-400">{t('loading')}</p>
          ) : tab === 'profile' ? (
            <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
              <StudentProfileFields
                value={profile}
                readOnly={!editable}
                onChange={editable ? setProfile : undefined}
                editableEmail={editable}
              />

              {editable ? (
                <>
                  {error && <p className="text-sm text-red-600">{error}</p>}
                  {saved && <p className="text-sm text-green-600">{tSheet('saved')}</p>}
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="w-full bg-[#6B1F3A] text-white rounded-lg py-2.5 text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
                  >
                    {saving ? tSheet('saving') : tSheet('save')}
                  </button>
                </>
              ) : (
                <p className="text-xs text-gray-400">{tSheet('editHint')}</p>
              )}
            </div>
          ) : (
            <StudentDocumentsPanel
              canManage
              studentId={studentId}
              // Una sola scuola: l'intestazione col nome non serve
              schools={[{ id: 'school', name: '', types }]}
              documents={docs}
              onReload={reload}
            />
          )}
        </div>
      </div>
    </div>
  )
}
