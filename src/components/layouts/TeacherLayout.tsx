'use client'

import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { Link, usePathname, useRouter } from '@/navigation'
import { useState } from 'react'
import RoleSwitcher from '@/components/RoleSwitcher'
import LocaleSwitcher from '@/components/LocaleSwitcher'
import BackButton from '@/components/ui/BackButton'

interface Props {
  children: React.ReactNode
  userName: string | null
  userEmail: string | null
}

export default function TeacherLayout({ children, userName, userEmail }: Props) {
  const t = useTranslations('layout')
  const tNav = useTranslations('nav.teacher')
  const pathname = usePathname()
  // Global back arrow (hidden on the landing dashboard of each panel)
  const showBack = !pathname.endsWith('/dashboard')
  const router = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState(true)

  const navItems = [
    { href: '/teacher/dashboard', label: tNav('dashboard') },
    { href: '/teacher/calendar', label: tNav('calendar') },
    { href: '/teacher/attendance', label: tNav('attendance') },
    { href: '/teacher/performance', label: tNav('performance') },
    { href: '/teacher/compensation', label: tNav('compensation') },
    { href: '/teacher/library', label: tNav('library') },
    { href: '/teacher/inbox', label: tNav('inbox') },
    { href: '/teacher/profile', label: tNav('profile') },
  ]

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/')
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar — hidden when closed */}
      <aside
        className={`${open ? 'w-60' : 'w-0'} bg-gray-800 flex flex-col shrink-0 overflow-hidden transition-all duration-200 h-full`}
      >
        <div className="w-60 flex flex-col h-full overflow-hidden">
          {/* Header */}
          <div className="px-6 py-5 border-b border-gray-700">
            <span className="text-white font-bold text-lg">No Under 40</span>
            <span className="block text-gray-400 text-xs mt-0.5">{t('teacher.panel')}</span>
            {(userName || userEmail) && (
              <div className="mt-2 pt-2 border-t border-gray-700">
                {userName && <span className="block text-white text-xs font-medium truncate">{userName}</span>}
                {userEmail && <span className="block text-gray-500 text-xs truncate">{userEmail}</span>}
              </div>
            )}
          </div>

          <nav className="flex-1 min-h-0 px-3 py-4 space-y-0.5 overflow-y-auto">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center px-3 py-2.5 rounded-lg text-sm transition whitespace-nowrap ${
                  pathname === item.href
                    ? 'bg-white/20 text-white font-medium'
                    : 'text-gray-400 hover:bg-white/10 hover:text-white'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <RoleSwitcher currentRole="teacher" variant="dark" />

          <div className="px-3 py-3 border-t border-gray-700">
            <LocaleSwitcher variant="dark" />
          </div>

          <div className="px-3 py-4 border-t border-gray-700">
            <button
              onClick={handleSignOut}
              className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-gray-400 hover:bg-white/10 hover:text-white transition whitespace-nowrap"
            >
              {t('signOut')}
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-8">{showBack && <BackButton />}{children}</div>
      </main>
      {/* Sidebar toggle — icona in alto a sinistra (stile Svolgo) */}
      <button
        onClick={() => setOpen(o => !o)}
        title={open ? t('closeSidebar') : t('openSidebar')}
        className={`fixed top-4 ${open ? 'left-[248px]' : 'left-4'} z-50 w-9 h-9 flex items-center justify-center rounded-lg bg-gray-900 hover:bg-gray-700 text-white transition-all duration-200 shadow-md`}
      >
        {open ? (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 0 1-.02 1.06L8.832 10l3.938 3.71a.75.75 0 1 1-1.04 1.08l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.06.02Z" clipRule="evenodd" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm0 5.25A.75.75 0 0 1 2.75 9.25h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 10Zm0 5.25a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
          </svg>
        )}
      </button>
      {/* Esci — sempre visibile, accanto al toggle: logout e ritorno alla homepage */}
      <button
        onClick={handleSignOut}
        title={t('signOut')}
        className={`fixed top-4 ${open ? 'left-[296px]' : 'left-[52px]'} z-50 w-9 h-9 flex items-center justify-center rounded-lg bg-gray-900 hover:bg-gray-700 text-white transition-all duration-200 shadow-md`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M18 15l3-3m0 0-3-3m3 3H9" />
        </svg>
      </button>
    </div>
  )
}
