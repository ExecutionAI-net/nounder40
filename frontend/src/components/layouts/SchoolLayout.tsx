'use client'

import { useTranslations } from 'next-intl'
import { Link, usePathname, useRouter } from '@/navigation'
import { useState } from 'react'
import RoleSwitcher from '@/components/RoleSwitcher'
import LocaleSwitcher from '@/components/LocaleSwitcher'
import BackButton from '@/components/ui/BackButton'
import SchoolSwitcher from '@/components/school/SchoolSwitcher'
import BrandLogo from '@/components/BrandLogo'
import NavIcon, { UnreadBadge } from '@/components/layouts/NavIcon'
import { useUnreadMessages } from '@/lib/use-unread'
import { useAuth } from '@/lib/api/auth-context'
import { useRequireRole } from '@/lib/api/guards'

export default function SchoolLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('layout')
  const tNav = useTranslations('nav.school')
  const pathname = usePathname()
  // Global back arrow (hidden on the landing dashboard of each panel)
  const showBack = !pathname.endsWith('/dashboard')
  const router = useRouter()
  const { user, loading: authLoading, logout } = useAuth()
  useRequireRole('school')
  const [open, setOpen] = useState(true)
  // Mobile: drawer in sovrapposizione (si chiude scegliendo una voce)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const unread = useUnreadMessages('school')

  const baseNavItems = [
    { href: '/school/dashboard', key: 'dashboard', label: tNav('dashboard') },
    { href: '/school/profile', key: 'profile', label: tNav('profile') },
    { href: '/school/locations', key: 'locations', label: tNav('locations') },
    { href: '/school/calendar', key: 'calendar', label: tNav('calendar') },
    { href: '/school/courses', key: 'courses', label: tNav('courses') },
    { href: '/school/lessons', key: 'lessons', label: tNav('lessons') },
    { href: '/school/teachers', key: 'teachers', label: tNav('teachers') },
    { href: '/school/compensation', key: 'compensation', label: tNav('compensation') },
    { href: '/school/students', key: 'students', label: tNav('students') },
    // Un solo motore: gli abbonamenti sono pacchetti ricorrenti, gestiti da
    // "Pacchetti" (PACKAGE_TO_SUBSCRIPTION.md — la sezione dedicata è ritirata).
    { href: '/school/packages', key: 'packages', label: tNav('packages') },
    { href: '/school/payments', key: 'payments', label: tNav('payments') },
    { href: '/school/documents', key: 'documents', label: tNav('documents') },
    { href: '/school/inbox', key: 'inbox', label: tNav('inbox') },
    { href: '/school/reports', key: 'reports', label: tNav('reports') },
    { href: '/school/settings', key: 'settings', label: tNav('settings') },
    { href: '/school/settings/statuses', key: 'attendanceStatuses', label: tNav('attendanceStatuses') },
    { href: '/school/credits', key: 'manualCredits', label: tNav('manualCredits') },
  ]

  const ownerOnlyItems = [
    { href: '/school/team', key: 'team', label: tNav('team') },
  ]

  const navItems = user?.school_sub_role === 'owner' ? [...baseNavItems, ...ownerOnlyItems] : baseNavItems

  async function handleSignOut() {
    await logout()
    router.push('/')
  }

  if (authLoading || !user) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50" />
  }

  const userName = user.full_name || null
  const userEmail = user.email || null

  return (
    <div className="flex flex-col md:flex-row h-dvh bg-gray-50">
      {/* Header mobile: logo + nome pagina, burger a destra. La sidebar
          in-flow resta solo su desktop. */}
      <div className="md:hidden sticky top-0 z-40 bg-gray-900 px-4 py-2.5 flex items-center justify-between">
        <BrandLogo className="h-8" onDark />
        <button
          onClick={() => setMobileMenuOpen(true)}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-300 hover:bg-white/10 transition"
          aria-label={t('openSidebar')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm0 5.25A.75.75 0 0 1 2.75 9.25h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 10Zm0 5.25a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* Drawer mobile in sovrapposizione: scegli una voce e si chiude */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-[60]" onClick={() => setMobileMenuOpen(false)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div
            className="absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-gray-900 shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-4 border-b border-gray-800 flex items-center justify-between">
              <div className="min-w-0">
                {userName && <span className="block text-white text-sm font-medium truncate">{userName}</span>}
                {userEmail && <span className="block text-gray-500 text-xs truncate">{userEmail}</span>}
              </div>
              <button onClick={() => setMobileMenuOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-white/10" aria-label={t('closeSidebar')}>
                ✕
              </button>
            </div>
            <SchoolSwitcher />
            <nav className="flex-1 min-h-0 px-3 py-3 space-y-0.5 overflow-y-auto">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition ${
                    pathname === item.href
                      ? 'bg-white/20 text-white font-medium'
                      : 'text-gray-400 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <NavIcon name={item.key} />
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.key === 'inbox' && <UnreadBadge count={unread.total} />}
                </Link>
              ))}
            </nav>
            <RoleSwitcher currentRole="school" variant="dark" />
            <div className="px-3 py-3 border-t border-gray-800">
              <LocaleSwitcher variant="dark" />
            </div>
            <div className="px-3 py-3 border-t border-gray-800">
              <button
                onClick={handleSignOut}
                className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-gray-400 hover:bg-white/10 hover:text-white transition"
              >
                {t('signOut')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar — hidden when closed */}
      <aside
        className={`${open ? 'w-60' : 'w-12'} bg-gray-900 hidden md:flex flex-col shrink-0 overflow-hidden transition-all duration-200 h-full`}
      >
        {/* Rail compatto a sidebar chiusa: apri + esci nel proprio spazio */}
        {!open && (
          <div className="flex flex-col items-center gap-1.5 pt-3">
            <button onClick={() => setOpen(true)} title={t('openSidebar')} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm0 5.25A.75.75 0 0 1 2.75 9.25h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 10Zm0 5.25a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" /></svg></button>
            <button onClick={handleSignOut} title={t('signOut')} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M18 15l3-3m0 0-3-3m3 3H9" /></svg></button>
          </div>
        )}
        <div className={`w-60 flex-col h-full overflow-hidden ${open ? 'flex' : 'hidden'}`}>
          {/* Header */}
          <div className="px-4 py-4 border-b border-gray-800">
            <div className="flex items-center justify-between gap-2">
              <BrandLogo className="h-10 shrink-0" onDark />
              <div className="flex gap-1 shrink-0">
              <button onClick={() => setOpen(false)} title={t('closeSidebar')} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M12.79 5.23a.75.75 0 0 1-.02 1.06L8.832 10l3.938 3.71a.75.75 0 1 1-1.04 1.08l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.06.02Z" clipRule="evenodd" /></svg></button>
              <button onClick={handleSignOut} title={t('signOut')} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M18 15l3-3m0 0-3-3m3 3H9" /></svg></button>
              </div>
            </div>
            {(userName || userEmail) && (
              <div className="mt-2 pt-2 border-t border-gray-800">
                {userName && <span className="block text-white text-xs font-medium truncate">{userName}</span>}
                {userEmail && <span className="block text-gray-500 text-xs truncate">{userEmail}</span>}
              </div>
            )}
          </div>

          {/* Active school name + multi-school switcher */}
          <SchoolSwitcher />

          <nav className="flex-1 min-h-0 px-3 py-4 space-y-0.5 overflow-y-auto">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition whitespace-nowrap ${
                  pathname === item.href
                    ? 'bg-white/20 text-white font-medium'
                    : 'text-gray-400 hover:bg-white/10 hover:text-white'
                }`}
              >
                <NavIcon name={item.key} />
                <span className="flex-1 truncate">{item.label}</span>
                {item.key === 'inbox' && <UnreadBadge count={unread.total} />}
              </Link>
            ))}
          </nav>

          <RoleSwitcher currentRole="school" variant="dark" />

          <div className="px-3 py-3 border-t border-gray-800">
            <LocaleSwitcher variant="dark" />
          </div>

          <div className="px-3 py-4 border-t border-gray-800">
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
        <div className="p-4 md:p-8">{showBack && <div className="hidden md:block"><BackButton /></div>}{children}</div>
      </main>
    </div>
  )
}
