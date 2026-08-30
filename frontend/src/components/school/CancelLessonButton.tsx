'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { apiFetch } from '@/lib/api/client'

// "Annulla lezione e storna i crediti": lo stesso bottone in Lezioni e in
// Corsi → vedi lezioni. Primo clic arma (si disarma da solo dopo 4 s),
// secondo clic chiede conferma con il numero di allieve rimborsate.
// Backend: DELETE /school/classes/{id}/ — rimborsa tutte, lezione "annullata",
// email "Lezione annullata dalla scuola".
export default function CancelLessonButton({
  lessonId,
  bookings,
  onDone,
  onError,
  className = '',
}: {
  lessonId: string
  bookings: number
  onDone?: () => void
  onError?: (err: unknown) => void
  className?: string
}) {
  const t = useTranslations('school.cancelLesson')
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)

  async function click() {
    if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 4000); return }
    setArmed(false)
    if (!window.confirm(t('confirm', { count: bookings }))) return
    setBusy(true)
    try {
      await apiFetch(`/school/classes/${lessonId}/`, { method: 'DELETE' })
      onDone?.()
    } catch (err) {
      onError?.(err)
    }
    setBusy(false)
  }

  return (
    <button
      type="button"
      onClick={click}
      disabled={busy}
      className={`text-xs px-3 py-1.5 rounded-lg transition disabled:opacity-50 whitespace-nowrap ${
        armed ? 'bg-red-600 text-white hover:bg-red-700' : 'border border-red-100 text-red-400 hover:bg-red-50'
      } ${className}`}
    >
      {busy ? t('cancelling') : armed ? t('armed') : t('cancel')}
    </button>
  )
}
