'use client'

import { useTranslations } from 'next-intl'

// Le due note di corso / lezione, una accanto all'altra con le etichette
// che dicono chi le legge: la prima finisce sulla card di prenotazione
// dell'allieva, la seconda la vedono solo scuola e insegnanti (presenze).
// Stesso blocco in crea corso, modifica corso e modifica lezione.
export default function NotesFields({
  notes,
  internalNotes,
  onNotesChange,
  onInternalChange,
  courseInternalNotes,
  inputClassName = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20',
  labelClassName = 'block text-sm font-medium text-gray-700 mb-1',
}: {
  notes: string
  internalNotes: string
  onNotesChange: (value: string) => void
  onInternalChange: (value: string) => void
  /** Nella modifica lezione: la nota interna del corso, che vale per tutte le sue lezioni */
  courseInternalNotes?: string
  inputClassName?: string
  labelClassName?: string
}) {
  const t = useTranslations('lessonNotes')
  return (
    <>
      <div>
        <label className={labelClassName}>{t('publicLabel')}</label>
        <textarea value={notes} onChange={e => onNotesChange(e.target.value)} rows={3}
          className={`${inputClassName} resize-y`} placeholder={t('publicPlaceholder')} />
        <p className="text-xs text-gray-400 mt-1">{t('publicHint')}</p>
      </div>
      <div className="p-4 bg-amber-50/60 border border-amber-200 rounded-xl">
        <label className={labelClassName}>🔒 {t('internalLabel')}</label>
        {courseInternalNotes && (
          <p className="text-xs text-gray-600 mb-2 whitespace-pre-line">
            <span className="font-medium">{t('courseInternalLabel')}:</span> {courseInternalNotes}
          </p>
        )}
        <textarea value={internalNotes} onChange={e => onInternalChange(e.target.value)} rows={3} maxLength={5000}
          className={`${inputClassName} resize-y bg-white`} placeholder={t('internalPlaceholder')} />
        <p className="text-xs text-gray-400 mt-1">{t('internalHint')}</p>
      </div>
    </>
  )
}
