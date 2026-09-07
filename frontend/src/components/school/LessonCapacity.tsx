'use client'

import { useTranslations } from 'next-intl'
import type { LessonFullInfo } from '@/lib/lesson-closure'

/** R2-M12: la lezione è al completo. Lo sportello può comunque iscrivere, ma
 *  deve dirlo: la conferma mostra i numeri veri e la POST viene rifatta con
 *  `allow_overbooking: true`. */
export function LessonFullDialog({
  info, busy, onConfirm, onCancel,
}: {
  info: LessonFullInfo
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const t = useTranslations('lessonCapacity')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
        <h3 className="font-semibold text-gray-900 text-base">{t('fullTitle')}</h3>
        <p className="text-sm text-gray-500">{t('fullBody', { current: info.current, max: info.max })}</p>
        <div className="flex gap-2 pt-1">
          <button
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 px-4 py-2.5 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700 transition disabled:opacity-50"
          >
            {busy ? t('enrolling') : t('enrolAnyway')}
          </button>
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition disabled:opacity-50"
          >
            {t('goBack')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Indicatore permanente sul registro/scheda lezione quando si è sforato. */
export function OverCapacityBadge({ current, max }: LessonFullInfo) {
  const t = useTranslations('lessonCapacity')
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-50 border border-amber-200 text-amber-700 text-xs font-medium rounded-full">
      ⚠️ {t('overBadge', { current, max })}
    </span>
  )
}
