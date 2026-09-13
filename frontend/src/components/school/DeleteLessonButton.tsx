'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { apiFetch, ApiError } from '@/lib/api/client'
import { useArmedAction } from '@/lib/useArmedAction'

// Secondo passo dopo "Annulla lezione e storna i crediti": elimina per sempre
// una lezione ANNULLATA da tutti i calendari (scuola, insegnante, allieve).
// Backend: DELETE /school/classes/{id}/purge/ — rifiuta con 409 una lezione
// non annullata o con prenotazioni ancora confermate (crediti non stornati).
export default function DeleteLessonButton({
  lessonId,
  onDone,
  className = '',
}: {
  lessonId: string
  onDone?: () => void
  className?: string
}) {
  const t = useTranslations('school.deleteLesson')
  const [error, setError] = useState<string | null>(null)
  const { armed, busy, trigger } = useArmedAction(async () => {
    setError(null)
    try {
      await apiFetch(`/school/classes/${lessonId}/purge/`, { method: 'DELETE' })
      onDone?.()
    } catch (err) {
      const code = err instanceof ApiError && err.status === 409 && err.body && typeof err.body === 'object'
        ? (err.body as { error?: string }).error : undefined
      setError(
        code === 'not_cancelled' ? t('errorNotCancelled')
          : code === 'has_confirmed_bookings' ? t('errorHasBookings')
          : code === 'has_attendance_history' ? t('errorHasHistory')
          : t('errorFailed')
      )
    }
  }, { confirm: () => t('confirm') })

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={trigger}
        disabled={busy}
        title={t('hint')}
        className={`text-xs px-3 py-1.5 rounded-lg transition disabled:opacity-50 ${
          armed ? 'bg-gray-900 text-white hover:bg-gray-700' : 'border border-gray-300 text-gray-500 hover:bg-gray-100'
        } ${className}`}
      >
        {busy ? t('deleting') : armed ? t('armed') : t('delete')}
      </button>
      {error && <span className="text-[11px] text-red-500">{error}</span>}
    </span>
  )
}
