'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

const navItems = [
  { href: '/student/dashboard', label: 'Home' },
  { href: '/student/book', label: 'Book' },
  { href: '/student/bookings', label: 'My Lessons' },
  { href: '/student/packages', label: 'Packages' },
  { href: '/student/shop', label: 'Shop' },
  { href: '/student/support', label: 'Support' },
  { href: '/student/notifications', label: 'Notifications' },
  { href: '/student/profile', label: 'Profile' },
]

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20 md:pb-0 md:flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-60 bg-white border-r border-gray-100 flex-col">
        <div className="px-6 py-5 border-b border-gray-100">
          <span className="text-[#6B1F3A] font-bold text-lg">No Under 40</span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center px-3 py-2.5 rounded-lg text-sm transition ${
                pathname === item.href
                  ? 'bg-[#6B1F3A]/10 text-[#6B1F3A] font-medium'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-gray-100">
          <button
            onClick={handleSignOut}
            className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-gray-500 hover:bg-gray-100 transition"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-4 md:p-8">{children}</div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 flex">
        {navItems.slice(0, 5).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex-1 flex flex-col items-center py-3 text-xs transition ${
              pathname === item.href
                ? 'text-[#6B1F3A] font-medium'
                : 'text-gray-400'
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
