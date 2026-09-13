'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { apiFetch } from '@/lib/api/client'
import { useArmedAction } from '@/lib/useArmedAction'

// "Elimina le annullate (N)": tutte le lezioni annullate nell'intervallo
// mostrato spariscono da ogni calendario. Backend:
// POST /school/classes/purge-cancelled/ {from, to, course_id?} — salta quelle
// con prenotazioni ancora confermate (vanno prima annullate davvero).
export default function PurgeCancelledButton({
  from,
  to,
  count,
  courseId,
  onDone,
  className = '',
}: {
  from: string
  to: string
  count: number
  courseId?: string
  onDone?: (deleted: number) => void
  className?: string
}) {
  const t = useTranslations('school.deleteLesson')
  const [error, setError] = useState<string | null>(null)
  const { armed, busy, trigger } = useArmedAction(async () => {
    setError(null)
    try {
      const res = await apiFetch<{ deleted: number }>('/school/classes/purge-cancelled/', {
        method: 'POST',
        body: JSON.stringify({ from, to, ...(courseId ? { course_id: courseId } : {}) }),
      })
      onDone?.(res?.deleted ?? 0)
    } catch {
      setError(t('errorFailed'))
    }
  }, { confirm: () => t('bulkConfirm', { count }) })

  if (count <= 0) return null
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
        {busy ? t('deleting') : armed ? t('armed') : t('bulk', { count })}
      </button>
      {error && <span className="text-[11px] text-red-500">{error}</span>}
    </span>
  )
}
