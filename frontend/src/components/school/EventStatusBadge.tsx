'use client'

import { useTranslations } from 'next-intl'

// Approval state of a special event (SPECIAL_EVENTS.md), same colours on the
// school list, the school edit page and the HQ queue.
export const EVENT_STATUS_STYLE: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-600',
  suspended: 'bg-orange-100 text-orange-700',
  cancelled: 'bg-gray-100 text-gray-400',
}

export default function EventStatusBadge({ status, changed }: { status: string; changed?: boolean }) {
  const t = useTranslations('school.events.status')
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${EVENT_STATUS_STYLE[status] ?? 'bg-gray-100 text-gray-500'}`}>
        {t.has(status) ? t(status) : status}
      </span>
      {changed && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">{t('modified')}</span>
      )}
    </span>
  )
}
