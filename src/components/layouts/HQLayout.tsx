'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

const navItems = [
  { href: '/hq/dashboard', label: 'Dashboard' },
  { href: '/hq/schools', label: 'Schools' },
  { href: '/hq/team', label: 'Team' },
  { href: '/hq/lesson-types', label: 'Lesson Types' },
  { href: '/hq/payments', label: 'Payments' },
  { href: '/hq/inbox', label: 'Inbox' },
  { href: '/hq/library', label: 'Library' },
  { href: '/hq/reports', label: 'Reports' },
]

export default function HQLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-60 bg-[#6B1F3A] flex flex-col">
        <div className="px-6 py-5 border-b border-[#5a1930]">
          <span className="text-white font-bold text-lg">No Under 40</span>
          <span className="block text-[#e8a0b4] text-xs mt-0.5">HQ Panel</span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center px-3 py-2.5 rounded-lg text-sm transition ${
                pathname === item.href
                  ? 'bg-white/20 text-white font-medium'
                  : 'text-[#e8a0b4] hover:bg-white/10 hover:text-white'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-[#5a1930]">
          <button
            onClick={handleSignOut}
            className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-[#e8a0b4] hover:bg-white/10 hover:text-white transition"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-8">{children}</div>
      </main>
    </div>
  )
}
