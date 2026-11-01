'use client'

import { useTranslations } from 'next-intl'
import { monthRangeIso } from '@/lib/format-date'

// "This month" / "Last month" next to a pair of free date inputs: one click
// sets both bounds, the inputs stay editable (Carlo, 2026-10-31). The button
// whose month the inputs currently hold is shown pressed.
// `label` names the pair of dates the buttons drive when a page has more
// than one ("Quick period · Booking"), so two pickers in a row read apart.
export default function QuickMonthPicker({ from, to, onChange, label }: {
  from: string
  to: string
  onChange: (from: string, to: string) => void
  label?: string
}) {
  const t = useTranslations('tableTools')
  const heading = label ? `${t('quickPeriod')} · ${label}` : t('quickPeriod')
  return (
    <div role="group" aria-label={heading}>
      <p className="text-xs text-gray-500 mb-1">{heading}</p>
      <div className="flex gap-1.5">
        {([['thisMonth', 0], ['lastMonth', -1]] as const).map(([key, offset]) => {
          const range = monthRangeIso(offset)
          const active = from === range.from && to === range.to
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(range.from, range.to)}
              className={`px-3 py-2 text-xs rounded-lg border transition ${active
                ? 'bg-[#6B1F3A] text-white border-[#6B1F3A]'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >
              {t(key)}
            </button>
          )
        })}
      </div>
    </div>
  )
}
