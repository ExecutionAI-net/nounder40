'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

const navItems = [
  { href: '/school/dashboard', label: 'Dashboard' },
  { href: '/school/calendar', label: 'Calendar' },
  { href: '/school/lessons', label: 'Lessons' },
  { href: '/school/teachers', label: 'Teachers' },
  { href: '/school/students', label: 'Students' },
  { href: '/school/packages', label: 'Packages' },
  { href: '/school/subscriptions', label: 'Subscriptions' },
  { href: '/school/payments', label: 'Payments' },
  { href: '/school/documents', label: 'Documents' },
  { href: '/school/inbox', label: 'Inbox' },
  { href: '/school/settings', label: 'Settings' },
]

export default function SchoolLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

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
