'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api/client'

// Toggle di visibilità piattaforma (HQ): legge {enabled} dall'endpoint, salva
// subito al click con rollback se il POST fallisce. Usato per "Negozio
// visibile alle allieve" (hq/shop) e "Crediti visibili alle allieve"
// (hq/lesson-types); il backend è una vista PlatformSetting per ciascuno.
export default function PlatformVisibilityToggle({ endpoint, onLabel, offLabel, hint, offTone = 'gray' }: {
  /** es. '/hq/student-credits-visibility/' */
  endpoint: string
  onLabel: string
  offLabel: string
  hint?: string
  /** 'amber' = spento è uno stato d'allerta (es. negozio nascosto) */
  offTone?: 'gray' | 'amber'
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  useEffect(() => {
    apiFetch<{ enabled: boolean }>(endpoint)
      .then(r => setEnabled(r.enabled))
      .catch(() => {})
  }, [endpoint])

  async function toggle() {
    if (enabled === null) return
    const next = !enabled
    setEnabled(next)
    try {
      await apiFetch(endpoint, { method: 'POST', body: JSON.stringify({ enabled: next }) })
    } catch {
      setEnabled(!next) // rollback on failure
    }
  }

  if (enabled === null) return null
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none" title={hint}>
      <div className="relative">
        <input type="checkbox" className="sr-only" checked={enabled} onChange={toggle} />
        <div className={`w-10 h-6 rounded-full transition ${enabled ? 'bg-[#6B1F3A]' : 'bg-gray-200'}`} />
        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${enabled ? 'left-5' : 'left-1'}`} />
      </div>
      <span className={`text-sm font-medium ${enabled ? 'text-gray-700' : offTone === 'amber' ? 'text-amber-600' : 'text-gray-700'}`}>
        {enabled ? onLabel : offLabel}
      </span>
    </label>
  )
}
