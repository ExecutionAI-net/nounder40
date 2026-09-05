'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from '@/navigation'
import { useAuth } from '@/lib/api/auth-context'

const ROLE_DASHBOARDS: Record<string, string> = {
  hq: '/hq/dashboard',
  school: '/school/dashboard',
  teacher: '/teacher/dashboard',
  student: '/student/dashboard',
}

// 'hq' = burgundy sidebar, 'dark' = gray-800/900, 'light' = white
type Variant = 'hq' | 'dark' | 'light'

const styles: Record<Variant, { button: string; border: string }> = {
  hq: {
    button: 'bg-white/5 text-[#e8a0b4] hover:bg-white/15 hover:text-white border border-white/10',
    border: 'border-[#5a1930]',
  },
  dark: {
    button: 'bg-white/5 text-gray-400 hover:bg-white/15 hover:text-white border border-white/10',
    border: 'border-gray-700',
  },
  light: {
    button: 'bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-900 border border-gray-100',
    border: 'border-gray-100',
  },
}

export default function RoleSwitcher({ currentRole, variant, collapsed }: { currentRole: string; variant: Variant; collapsed?: boolean }) {
  const t = useTranslations('roleSwitcher')
  const router = useRouter()
  const { user } = useAuth()

  const roles: string[] = user?.roles?.length ? user.roles : user?.role ? [user.role] : []
  const otherRoles = roles.filter(r => r !== currentRole && ROLE_DASHBOARDS[r])

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

  // Compact horizontal row of pills, no section label — keeps the sidebar
  // footer from growing with the vertical "switch dashboard" list it used to be.
  const gridCols = otherRoles.length >= 3 ? 'grid-cols-3' : otherRoles.length === 2 ? 'grid-cols-2' : 'grid-cols-1'

  return (
    <div className={`px-3 pt-3 pb-2 border-t ${s.border}`}>
      <div className={`grid ${gridCols} gap-1.5`}>
        {otherRoles.map(role => (
          <button
            key={role}
            onClick={() => router.push(ROLE_DASHBOARDS[role])}
            title={t(role as 'hq' | 'school' | 'teacher' | 'student')}
            className={`flex items-center justify-center gap-1 px-1.5 py-2 rounded-lg text-[11px] font-medium transition ${s.button}`}
          >
            <span className="truncate">{t(role as 'hq' | 'school' | 'teacher' | 'student')}</span>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 shrink-0 opacity-60">
              <path fillRule="evenodd" d="M4.22 11.78a.75.75 0 0 1 0-1.06L9.44 5.5H5.75a.75.75 0 0 1 0-1.5h5.5a.75.75 0 0 1 .75.75v5.5a.75.75 0 0 1-1.5 0V6.56l-5.22 5.22a.75.75 0 0 1-1.06 0Z" clipRule="evenodd" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  )
}
