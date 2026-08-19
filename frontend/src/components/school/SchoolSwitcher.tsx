'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { apiFetch } from '@/lib/api/client'

type Membership = { school_id: string; sub_role: string; school: { id: string; name: string; city: string | null } }

// Sidebar block: shows the ACTIVE school name; with multiple memberships it
// becomes a selector that switches the active school (profiles.school_id).
export default function SchoolSwitcher() {
  const t = useTranslations('layout')
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [switching, setSwitching] = useState(false)

  useEffect(() => {
    apiFetch<{ memberships: Membership[]; activeSchoolId: string | null }>('/school/memberships/')
      .then((d) => {
        setMemberships(d.memberships ?? [])
        setActiveId(d.activeSchoolId ?? null)
      })
      .catch(() => {})
  }, [])

  const active = memberships.find(m => m.school_id === activeId)?.school

  async function handleSwitch(schoolId: string) {
    if (schoolId === activeId || switching) return
    setSwitching(true)
    try {
      await apiFetch('/school/memberships/', { method: 'POST', body: JSON.stringify({ school_id: schoolId }) })
      setActiveId(schoolId)
      // Full reload: every page must re-read the active school
      window.location.reload()
      return
    } catch {
      // fall through to reset switching state below
    }
    setSwitching(false)
  }

  if (!active) return null

  // Single school: just show its name (the user must always see where they are)
  if (memberships.length <= 1) {
    return (
      <div className="px-6 py-3 border-b border-gray-700">
        <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">{t('school.currentSchool')}</p>
        <p className="text-sm text-white font-medium truncate mt-0.5">{active.name}</p>
        {active.city && <p className="text-xs text-gray-400 truncate">{active.city}</p>}
      </div>
    )
  }

  return (
    <div className="px-4 py-3 border-b border-gray-700">
      <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold px-2 mb-1.5">{t('school.currentSchool')}</p>
      <select
        value={activeId ?? ''}
        onChange={e => handleSwitch(e.target.value)}
        disabled={switching}
        className="w-full px-2 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white font-medium focus:outline-none focus:ring-2 focus:ring-white/20 cursor-pointer disabled:opacity-50"
      >
        {memberships.map(m => (
          <option key={m.school_id} value={m.school_id}>
            {m.school.name}{m.school.city ? ` — ${m.school.city}` : ''}
          </option>
        ))}
      </select>
    </div>
  )
}
