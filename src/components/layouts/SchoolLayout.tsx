'use client'

import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { Link, usePathname, useRouter } from '@/navigation'
import { useState } from 'react'
import RoleSwitcher from '@/components/RoleSwitcher'
import LocaleSwitcher from '@/components/LocaleSwitcher'

interface Props {
  children: React.ReactNode
  userName: string | null
  userEmail: string | null
  schoolSubRole: string | null
}

export default function SchoolLayout({ children, userName, userEmail, schoolSubRole }: Props) {
  const t = useTranslations('layout')
  const tNav = useTranslations('nav.school')
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState(true)

  const baseNavItems = [
    { href: '/school/dashboard', label: tNav('dashboard') },
    { href: '/school/profile', label: tNav('profile') },
    { href: '/school/locations', label: tNav('locations') },
    { href: '/school/calendar', label: tNav('calendar') },
    { href: '/school/courses', label: tNav('courses') },
    { href: '/school/teachers', label: tNav('teachers') },
    { href: '/school/compensation', label: tNav('compensation') },
    { href: '/school/students', label: tNav('students') },
    { href: '/school/packages', label: tNav('packages') },
    { href: '/school/subscriptions', label: tNav('subscriptions') },
    { href: '/school/payments', label: tNav('payments') },
    { href: '/school/documents', label: tNav('documents') },
    { href: '/school/inbox', label: tNav('inbox') },
    { href: '/school/reports', label: tNav('reports') },
    { href: '/school/settings', label: tNav('settings') },
    { href: '/school/settings/statuses', label: tNav('attendanceStatuses') },
    { href: '/school/credits', label: tNav('manualCredits') },
  ]

  const ownerOnlyItems = [
    { href: '/school/team', label: tNav('team') },
  ]

  const navItems = schoolSubRole === 'owner' ? [...baseNavItems, ...ownerOnlyItems] : baseNavItems

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar — hidden when closed */}
      <aside
        className={`${open ? 'w-60' : 'w-0'} bg-gray-900 flex flex-col shrink-0 overflow-hidden transition-all duration-200 h-full`}
      >
        <div className="w-60 flex flex-col h-full overflow-hidden">
          {/* Header */}
          <div className="px-6 py-5 border-b border-gray-800">
            <span className="text-white font-bold text-lg">No Under 40</span>
            <span className="block text-gray-400 text-xs mt-0.5">{t('school.panel')}</span>
            {(userName || userEmail) && (
              <Link
                href="/school/account"
                className="block mt-2 pt-2 border-t border-gray-800 hover:opacity-80 transition"
              >
                {userName && <span className="block text-white text-xs font-medium truncate">{userName}</span>}
                {userEmail && <span className="block text-gray-500 text-xs truncate">{userEmail}</span>}
              </Link>
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

          <RoleSwitcher currentRole="school" variant="dark" />

          <div className="px-3 py-3 border-t border-gray-800">
            <LocaleSwitcher variant="dark" />
          </div>

          <div className="px-3 py-4 border-t border-gray-800 space-y-0.5">
            <Link
              href="/school/account"
              className={`flex items-center px-3 py-2.5 rounded-lg text-sm transition whitespace-nowrap ${
                pathname === '/school/account'
                  ? 'bg-white/20 text-white font-medium'
                  : 'text-gray-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              My Account
            </Link>
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
        <div className="p-8">{children}</div>
      </main>

      {/* Sidebar toggle */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-6 left-4 z-50 flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-700 transition shadow-md text-xs font-medium"
      >
        {open ? (
          <>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
              <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 0 1-.02 1.06L8.832 10l3.938 3.71a.75.75 0 1 1-1.04 1.08l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.06.02Z" clipRule="evenodd" />
            </svg>
            {t('closeSidebar')}
          </>
        ) : (
          <>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
              <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z" clipRule="evenodd" />
            </svg>
            {t('openSidebar')}
          </>
        )}
      </button>
    </div>
  )
}
