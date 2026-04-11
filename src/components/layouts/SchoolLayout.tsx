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
  { href: '/school/courses', label: 'Courses' },
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
  { href: '/school/credits', label: 'Manual Credits' },
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
      {/* Sidebar — hidden when closed */}
      <aside
        className={`${open ? 'w-60' : 'w-0'} bg-gray-900 flex flex-col shrink-0 overflow-hidden transition-all duration-200`}
      >
        <div className="w-60 flex flex-col flex-1 overflow-hidden">
          {/* Header */}
          <div className="px-6 py-5 border-b border-gray-800">
            <span className="text-white font-bold text-lg">No Under 40</span>
            <span className="block text-gray-400 text-xs mt-0.5">School Panel</span>
            {(userName || userEmail) && (
              <div className="mt-2 pt-2 border-t border-gray-800">
                {userName && <span className="block text-white text-xs font-medium truncate">{userName}</span>}
                {userEmail && <span className="block text-gray-500 text-xs truncate">{userEmail}</span>}
              </div>
            )}
          </div>

          <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
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

          <div className="px-3 py-4 border-t border-gray-800">
            <button
              onClick={handleSignOut}
              className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-gray-400 hover:bg-white/10 hover:text-white transition whitespace-nowrap"
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-8">{children}</div>
      </main>

      {/* Sidebar toggle — fixed bottom left, clear of back buttons */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-6 left-4 z-50 flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-700 transition shadow-md text-xs font-medium"
      >
        {open ? (
          <>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
              <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 0 1-.02 1.06L8.832 10l3.938 3.71a.75.75 0 1 1-1.04 1.08l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.06.02Z" clipRule="evenodd" />
            </svg>
            Close sidebar
          </>
        ) : (
          <>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
              <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z" clipRule="evenodd" />
            </svg>
            Open sidebar
          </>
        )}
      </button>
    </div>
  )
}
