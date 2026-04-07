'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import RoleSwitcher from '@/components/RoleSwitcher'

const baseNavItems = [
  { href: '/school/dashboard', label: 'Dashboard' },
  { href: '/school/profile', label: 'Profile' },
  { href: '/school/locations', label: 'Locations' },
  { href: '/school/calendar', label: 'Calendar' },
  { href: '/school/teachers', label: 'Teachers' },
  { href: '/school/compensation', label: 'Compensation' },
  { href: '/school/students', label: 'Students' },
  { href: '/school/packages', label: 'Packages' },
  { href: '/school/subscriptions', label: 'Subscriptions' },
  { href: '/school/payments', label: 'Payments' },
  { href: '/school/documents', label: 'Documents' },
  { href: '/school/inbox', label: 'Inbox' },
  { href: '/school/reports', label: 'Reports' },
  { href: '/school/settings', label: 'Settings' },
  { href: '/school/settings/statuses', label: 'Attendance Statuses' },
]

const ownerOnlyItems = [
  { href: '/school/team', label: 'Team' },
]

export default function SchoolLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [userName, setUserName] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [schoolSubRole, setSchoolSubRole] = useState<string | null>(null)
  const [open, setOpen] = useState(true)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setUserEmail(user.email ?? null)
      supabase.from('profiles').select('name, school_sub_role').eq('id', user.id).single()
        .then(({ data }) => {
          setUserName(data?.name ?? null)
          setSchoolSubRole(data?.school_sub_role ?? null)
          console.log('DEBUG: schoolSubRole =', data?.school_sub_role)
        })
    })
  }, [])

  const navItems = schoolSubRole === 'owner' ? [...baseNavItems, ...ownerOnlyItems] : baseNavItems

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <aside
        className={`${open ? 'w-60' : 'w-14'} bg-gray-900 flex flex-col shrink-0 transition-all duration-200`}
      >
        {/* Header */}
        <div className={`flex items-center border-b border-gray-800 ${open ? 'px-6 py-5' : 'px-0 py-5 justify-center'}`}>
          {open && (
            <div className="flex-1 min-w-0">
              <span className="text-white font-bold text-lg">No Under 40</span>
              <span className="block text-gray-400 text-xs mt-0.5">School Panel</span>
              {(userName || userEmail) && (
                <div className="mt-2 pt-2 border-t border-gray-800">
                  {userName && <span className="block text-white text-xs font-medium truncate">{userName}</span>}
                  {userEmail && <span className="block text-gray-500 text-xs truncate">{userEmail}</span>}
                </div>
              )}
            </div>
          )}
          <button
            onClick={() => setOpen(o => !o)}
            className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:bg-white/10 hover:text-white transition"
            title={open ? 'Collapse sidebar' : 'Expand sidebar'}
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
        </div>

        <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto overflow-x-hidden">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              title={!open ? item.label : undefined}
              className={`flex items-center rounded-lg text-sm transition ${
                open ? 'px-3 py-2.5' : 'px-0 py-2.5 justify-center'
              } ${
                pathname === item.href
                  ? 'bg-white/20 text-white font-medium'
                  : 'text-gray-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              {open ? item.label : (
                <span className="text-xs font-bold uppercase leading-none">
                  {item.label.slice(0, 2)}
                </span>
              )}
            </Link>
          ))}
        </nav>

        <RoleSwitcher currentRole="school" variant="dark" collapsed={!open} />

        <div className={`py-4 border-t border-gray-800 ${open ? 'px-3' : 'px-2'}`}>
          <button
            onClick={handleSignOut}
            title={!open ? 'Sign out' : undefined}
            className={`w-full rounded-lg text-sm text-gray-400 hover:bg-white/10 hover:text-white transition ${
              open ? 'text-left px-3 py-2.5' : 'flex justify-center py-2.5'
            }`}
          >
            {open ? 'Sign out' : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M3 4.25A2.25 2.25 0 0 1 5.25 2h5.5A2.25 2.25 0 0 1 13 4.25v2a.75.75 0 0 1-1.5 0v-2a.75.75 0 0 0-.75-.75h-5.5a.75.75 0 0 0-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 0 0 .75-.75v-2a.75.75 0 0 1 1.5 0v2A2.25 2.25 0 0 1 10.75 18h-5.5A2.25 2.25 0 0 1 3 15.75V4.25Z" clipRule="evenodd" />
                <path fillRule="evenodd" d="M6 10a.75.75 0 0 1 .75-.75h9.546l-1.048-.943a.75.75 0 1 1 1.004-1.114l2.5 2.25a.75.75 0 0 1 0 1.114l-2.5 2.25a.75.75 0 1 1-1.004-1.114l1.048-.943H6.75A.75.75 0 0 1 6 10Z" clipRule="evenodd" />
              </svg>
            )}
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="p-8">{children}</div>
      </main>
    </div>
  )
}
