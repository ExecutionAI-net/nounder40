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
      <aside className="w-60 bg-gray-900 flex flex-col">
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
              className={`flex items-center px-3 py-2.5 rounded-lg text-sm transition ${
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
            className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-gray-400 hover:bg-white/10 hover:text-white transition"
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="p-8">{children}</div>
      </main>
    </div>
  )
}
