'use client'

import { useTranslations } from 'next-intl'
import type { TeacherScope } from '@/lib/teacher-scope'

/** Interruttore "Le mie lezioni / Tutte le lezioni" (calendario e presenze
 * insegnante). Chi lo mostra decide se ha senso mostrarlo: vedi useTeacherScope. */
export default function ScopeToggle({ scope, onChange }: { scope: TeacherScope; onChange: (s: TeacherScope) => void }) {
  const t = useTranslations('teacher.calendar')
  return (
    <div className="flex bg-white border border-gray-200 rounded-lg p-1 gap-0.5">
      {(['mine', 'all'] as TeacherScope[]).map(s => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          className={`px-3 py-1.5 text-xs font-medium rounded transition ${
            scope === s ? 'bg-gray-800 text-white' : 'text-gray-500 hover:bg-gray-100'
          }`}
        >
          {s === 'mine' ? t('scopeMine') : t('scopeAll')}
        </button>
      ))}
    </div>
  )
}
