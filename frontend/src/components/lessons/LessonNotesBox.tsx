'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

// Le note della lezione nella pagina presenze, scuola e insegnante. Due
// pubblici: quella per le allieve (sola lettura qui, si cambia dalla scheda
// della lezione) e quella interna (si scrive qui, davanti alla classe).
// La nota interna del corso, se c'e', sta sopra: vale per tutte le lezioni.
export default function LessonNotesBox({
  publicNotes,
  courseInternalNotes,
  value,
  onSave,
}: {
  publicNotes: string
  courseInternalNotes: string
  value: string
  onSave: (value: string) => Promise<void>
}) {
  const t = useTranslations('lessonNotes')
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => { setDraft(value) }, [value])

  const dirty = draft.trim() !== value.trim()

  async function save() {
    setSaving(true)
    setFailed(false)
    setSaved(false)
    try {
      await onSave(draft.trim())
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      setFailed(true)
    }
    setSaving(false)
  }

  return (
    <div className="mb-4 p-4 bg-amber-50/60 border border-amber-200 rounded-xl space-y-3">
      {publicNotes && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t('publicLabel')}</p>
          <p className="text-sm text-gray-700 whitespace-pre-line">{publicNotes}</p>
        </div>
      )}
      {courseInternalNotes && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">🔒 {t('courseInternalLabel')}</p>
          <p className="text-sm text-gray-800 whitespace-pre-line">{courseInternalNotes}</p>
        </div>
      )}
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wide text-amber-700 mb-1">🔒 {t('internalLabel')}</label>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          rows={3}
          maxLength={5000}
          placeholder={t('internalPlaceholder')}
          className="w-full px-3 py-2 rounded-lg border border-amber-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-300/50 resize-none"
        />
        <div className="flex items-center justify-between gap-3 mt-1">
          <p className="text-xs text-gray-400">{t('internalHint')}</p>
          <div className="flex items-center gap-2 shrink-0">
            {saved && <span className="text-xs text-green-600">{t('saved')}</span>}
            {failed && <span className="text-xs text-red-500">{t('failed')}</span>}
            <button type="button" onClick={save} disabled={saving || !dirty}
              className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs font-medium hover:bg-gray-700 transition disabled:opacity-40">
              {saving ? t('saving') : t('save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
