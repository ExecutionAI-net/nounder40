'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import RoleSwitcher from '@/components/RoleSwitcher'
import { getNavItemsForRole } from '@/lib/hq-permissions'
import type { HQSubRole } from '@/lib/hq-permissions'

export default function HQLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [userName, setUserName] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [hqSubRole, setHqSubRole] = useState<HQSubRole | null>(null)
  const [navItems, setNavItems] = useState<Array<{ href: string; label: string; permission: string }>>([])
  const [open, setOpen] = useState(true)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setUserEmail(user.email ?? null)
      supabase.from('profiles').select('name, hq_sub_role').eq('id', user.id).single()
        .then(({ data }) => {
          setUserName(data?.name ?? null)
          const role = data?.hq_sub_role as HQSubRole
          setHqSubRole(role)
          setNavItems(getNavItemsForRole(role))
        })
    })
  }, [])

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar — hidden when closed */}
      <aside
        className={`${open ? 'w-60' : 'w-0'} bg-[#6B1F3A] flex flex-col shrink-0 overflow-hidden transition-all duration-200`}
      >
        <div className="w-60 flex flex-col flex-1 overflow-hidden">
          {/* Header */}
          <div className="px-6 py-5 border-b border-[#5a1930] flex items-start justify-between">
            <div className="min-w-0">
              <span className="text-white font-bold text-lg">No Under 40</span>
              <span className="block text-[#e8a0b4] text-xs mt-0.5">HQ Panel</span>
              {(userName || userEmail) && (
                <div className="mt-2 pt-2 border-t border-[#5a1930]">
                  {userName && <span className="block text-white text-xs font-medium truncate">{userName}</span>}
                  {userEmail && <span className="block text-[#c07090] text-xs truncate">{userEmail}</span>}
                </div>
              )}
            </div>
          </div>

          <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center px-3 py-2.5 rounded-lg text-sm transition whitespace-nowrap ${
                  pathname === item.href
                    ? 'bg-white/20 text-white font-medium'
                    : 'text-[#e8a0b4] hover:bg-white/10 hover:text-white'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <RoleSwitcher currentRole="hq" variant="hq" />

          <div className="px-3 py-4 border-t border-[#5a1930]">
            <button
              onClick={handleSignOut}
              className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-[#e8a0b4] hover:bg-white/10 hover:text-white transition whitespace-nowrap"
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto relative">
        {/* Toggle button — fixed to top-left of main content */}
        <button
          onClick={() => setOpen(o => !o)}
          className="sticky top-4 left-4 z-50 ml-4 mt-4 flex items-center justify-center w-8 h-8 rounded-lg bg-[#6B1F3A] text-white hover:bg-[#5a1930] transition shadow-sm"
          title={open ? 'Close sidebar' : 'Open sidebar'}
        >
          {open ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 0 1-.02 1.06L8.832 10l3.938 3.71a.75.75 0 1 1-1.04 1.08l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.06.02Z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z" clipRule="evenodd" />
            </svg>
          )}
        </button>
        <div className="px-8 pb-8">{children}</div>
      </main>
    </div>
  )
}
