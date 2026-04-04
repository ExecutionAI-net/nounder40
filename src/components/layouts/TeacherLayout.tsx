'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import RoleSwitcher from '@/components/RoleSwitcher'

const navItems = [
  { href: '/teacher/dashboard', label: 'Dashboard' },
  { href: '/teacher/calendar', label: 'Calendar' },
  { href: '/teacher/attendance', label: 'Attendance' },
  { href: '/teacher/performance', label: 'Performance' },
  { href: '/teacher/compensation', label: 'Compensation' },
  { href: '/teacher/library', label: 'Library' },
  { href: '/teacher/inbox', label: 'Inbox' },
  { href: '/teacher/profile', label: 'Profile' },
]

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [userName, setUserName] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setUserEmail(user.email ?? null)
      supabase.from('profiles').select('name').eq('id', user.id).single()
        .then(({ data }) => setUserName(data?.name ?? null))
    })
  }, [])

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="w-60 bg-gray-800 flex flex-col">
        <div className="px-6 py-5 border-b border-gray-700">
          <span className="text-white font-bold text-lg">No Under 40</span>
          <span className="block text-gray-400 text-xs mt-0.5">Teacher Panel</span>
          {(userName || userEmail) && (
            <div className="mt-2 pt-2 border-t border-gray-700">
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

        <RoleSwitcher currentRole="teacher" variant="dark" />

        <div className="px-3 py-4 border-t border-gray-700">
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
