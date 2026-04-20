'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { useRouter } from '@/navigation'
import { createClient } from '@/lib/supabase/client'

const ROLE_DASHBOARDS: Record<string, string> = {
  hq: '/hq/dashboard',
  school: '/school/dashboard',
  teacher: '/teacher/dashboard',
  student: '/student/dashboard',
}

// 'hq' = burgundy sidebar, 'dark' = gray-800/900, 'light' = white
type Variant = 'hq' | 'dark' | 'light'

const styles: Record<Variant, { label: string; button: string; border: string }> = {
  hq: {
    label: 'text-[#e8a0b4]/70',
    button: 'text-[#e8a0b4] hover:bg-white/10 hover:text-white border-[#5a1930]',
    border: 'border-[#5a1930]',
  },
  dark: {
    label: 'text-gray-500',
    button: 'text-gray-400 hover:bg-white/10 hover:text-white border-gray-700',
    border: 'border-gray-700',
  },
  light: {
    label: 'text-gray-400',
    button: 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 border-gray-100',
    border: 'border-gray-100',
  },
}

export default function RoleSwitcher({ currentRole, variant, collapsed }: { currentRole: string; variant: Variant; collapsed?: boolean }) {
  const t = useTranslations('roleSwitcher')
  const router = useRouter()
  const supabase = createClient()
  const [otherRoles, setOtherRoles] = useState<string[]>([])

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: profile } = await supabase
        .from('profiles')
        .select('roles, role')
        .eq('id', user.id)
        .single()
      if (!profile) return
      const roles: string[] = profile.roles?.length ? profile.roles : (profile.role ? [profile.role] : [])
      setOtherRoles(roles.filter(r => r !== currentRole && ROLE_DASHBOARDS[r]))
    }
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!otherRoles.length) return null

  const s = styles[variant]

  // Collapsed: show only icon buttons, no label
  if (collapsed) {
    return (
      <div className={`px-2 pt-2 pb-2 border-t ${s.border} space-y-1`}>
        {otherRoles.map(role => (
          <button
            key={role}
            onClick={() => router.push(ROLE_DASHBOARDS[role])}
            title={t(role as 'hq' | 'school' | 'teacher' | 'student')}
            className={`w-full flex justify-center py-2 rounded-lg text-xs transition ${s.button}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
              <path fillRule="evenodd" d="M4.22 11.78a.75.75 0 0 1 0-1.06L9.44 5.5H5.75a.75.75 0 0 1 0-1.5h5.5a.75.75 0 0 1 .75.75v5.5a.75.75 0 0 1-1.5 0V6.56l-5.22 5.22a.75.75 0 0 1-1.06 0Z" clipRule="evenodd" />
            </svg>
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className={`px-3 pt-3 pb-2 border-t ${s.border} space-y-1`}>
      <p className={`text-[10px] uppercase tracking-wider px-3 mb-2 font-semibold ${s.label}`}>
        {t('switchDashboard')}
      </p>
      {otherRoles.map(role => (
        <button
          key={role}
          onClick={() => router.push(ROLE_DASHBOARDS[role])}
          className={`w-full text-left px-3 py-2 rounded-lg text-xs transition flex items-center gap-2 ${s.button}`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 shrink-0">
            <path fillRule="evenodd" d="M4.22 11.78a.75.75 0 0 1 0-1.06L9.44 5.5H5.75a.75.75 0 0 1 0-1.5h5.5a.75.75 0 0 1 .75.75v5.5a.75.75 0 0 1-1.5 0V6.56l-5.22 5.22a.75.75 0 0 1-1.06 0Z" clipRule="evenodd" />
          </svg>
          {t(role as 'hq' | 'school' | 'teacher' | 'student')}
        </button>
      ))}
    </div>
  )
}
