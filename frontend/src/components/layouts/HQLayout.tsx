'use client'

import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { Link, usePathname, useRouter } from '@/navigation'
import { useState } from 'react'
import RoleSwitcher from '@/components/RoleSwitcher'
import LocaleSwitcher from '@/components/LocaleSwitcher'
import { getNavItemsForRole, getNavItemsForPermissions } from '@/lib/hq-permissions'
import type { HQSubRole } from '@/lib/hq-permissions'
import BackButton from '@/components/ui/BackButton'
import BrandLogo from '@/components/BrandLogo'
import NavIcon, { UnreadBadge } from '@/components/layouts/NavIcon'
import { useUnreadMessages } from '@/lib/use-unread'

interface Props {
  children: React.ReactNode
  userName: string | null
  userEmail: string | null
  hqSubRole: string | null
  permissions?: string[]
}

export default function HQLayout({ children, userName, userEmail, hqSubRole, permissions }: Props) {
  const t = useTranslations('layout')
  const tNav = useTranslations('nav.hq')
  const pathname = usePathname()
  // Global back arrow (hidden on the landing dashboard of each panel)
  const showBack = !pathname.endsWith('/dashboard')
  const router = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState(true)
  const unread = useUnreadMessages('hq')

  // Dynamic matrix from DB (custom profiles included); static map as fallback
  const navItems = permissions?.length
    ? getNavItemsForPermissions(permissions)
    : getNavItemsForRole(hqSubRole as HQSubRole)

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/')
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar — hidden when closed */}
      <aside
        className={`${open ? 'w-60' : 'w-12'} bg-[#6B1F3A] flex flex-col shrink-0 overflow-hidden transition-all duration-200 h-full`}
      >
        {/* Rail compatto a sidebar chiusa: apri + esci nel proprio spazio */}
        {!open && (
          <div className="flex flex-col items-center gap-1.5 pt-3">
            <button onClick={() => setOpen(true)} title={t('openSidebar')} className="w-7 h-7 flex items-center justify-center rounded-lg text-[#e8a0b4] hover:text-white hover:bg-white/10 transition"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm0 5.25A.75.75 0 0 1 2.75 9.25h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 10Zm0 5.25a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" /></svg></button>
            <button onClick={handleSignOut} title={t('signOut')} className="w-7 h-7 flex items-center justify-center rounded-lg text-[#e8a0b4] hover:text-white hover:bg-white/10 transition"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M18 15l3-3m0 0-3-3m3 3H9" /></svg></button>
          </div>
        )}
        <div className={`w-60 flex-col h-full overflow-hidden ${open ? 'flex' : 'hidden'}`}>
          {/* Header */}
          <div className="px-4 py-4 border-b border-[#5a1930]">
            <div className="flex items-center justify-between gap-2">
              <BrandLogo className="h-10 shrink-0" onDark />
              <div className="flex gap-1 shrink-0">
                <button onClick={() => setOpen(false)} title={t('closeSidebar')} className="w-7 h-7 flex items-center justify-center rounded-lg text-[#e8a0b4] hover:text-white hover:bg-white/10 transition"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M12.79 5.23a.75.75 0 0 1-.02 1.06L8.832 10l3.938 3.71a.75.75 0 1 1-1.04 1.08l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.06.02Z" clipRule="evenodd" /></svg></button>
                <button onClick={handleSignOut} title={t('signOut')} className="w-7 h-7 flex items-center justify-center rounded-lg text-[#e8a0b4] hover:text-white hover:bg-white/10 transition"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M18 15l3-3m0 0-3-3m3 3H9" /></svg></button>
              </div>
            </div>
            <div className="min-w-0">
              {(userName || userEmail) && (
                <div className="mt-2 pt-2 border-t border-[#5a1930]">
                  {userName && <span className="block text-white text-xs font-medium truncate">{userName}</span>}
                  {userEmail && <span className="block text-[#c07090] text-xs truncate">{userEmail}</span>}
                </div>
              )}
            </div>
          </div>

          <nav className="flex-1 min-h-0 px-3 py-4 space-y-0.5 overflow-y-auto">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition whitespace-nowrap ${
                  pathname === item.href
                    ? 'bg-white/20 text-white font-medium'
                    : 'text-[#e8a0b4] hover:bg-white/10 hover:text-white'
                }`}
              >
                <NavIcon name={item.key} />
                <span className="flex-1 truncate">{tNav(item.key)}</span>
                {item.key === 'inbox' && <UnreadBadge count={unread.total} />}
              </Link>
            ))}
          </nav>

          <RoleSwitcher currentRole="hq" variant="hq" />

          <div className="px-3 py-3 border-t border-[#5a1930]">
            <LocaleSwitcher variant="hq" />
          </div>

          <div className="px-3 py-4 border-t border-[#5a1930]">
            <button
              onClick={handleSignOut}
              className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-[#e8a0b4] hover:bg-white/10 hover:text-white transition whitespace-nowrap"
            >
              {t('signOut')}
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {pathname?.endsWith('/emails') ? children : (
          <div className="p-8 overflow-y-auto flex-1">{showBack && <BackButton />}{children}</div>
        )}
      </main>
    </div>
  )
}
