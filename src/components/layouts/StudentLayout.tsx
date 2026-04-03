'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import InstallPWAPrompt from '@/components/InstallPWAPrompt'
import SchoolSelectModal from '@/components/SchoolSelectModal'

const navItems = [
  { href: '/student/dashboard', label: 'Home' },
  { href: '/student/book', label: 'Book' },
  { href: '/student/bookings', label: 'My Lessons' },
  { href: '/student/buy', label: 'Buy Credits' },
  { href: '/student/packages', label: 'Packages' },
  { href: '/student/shop', label: 'Shop' },
  { href: '/student/support', label: 'Support' },
  { href: '/student/notifications', label: 'Notifications' },
  { href: '/student/profile', label: 'Profile' },
]

const bottomNavItems = [
  {
    href: '/student/dashboard',
    label: 'Home',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path d="M11.47 3.841a.75.75 0 0 1 1.06 0l8.69 8.69a.75.75 0 1 0 1.06-1.061l-8.689-8.69a2.25 2.25 0 0 0-3.182 0l-8.69 8.69a.75.75 0 1 0 1.061 1.06l8.69-8.689Z" />
        <path d="m12 5.432 8.159 8.159c.03.03.06.058.091.086v6.198c0 1.035-.84 1.875-1.875 1.875H15a.75.75 0 0 1-.75-.75v-4.5a.75.75 0 0 0-.75-.75h-3a.75.75 0 0 0-.75.75V21a.75.75 0 0 1-.75.75H5.625a1.875 1.875 0 0 1-1.875-1.875v-6.198a2.29 2.29 0 0 0 .091-.086L12 5.432Z" />
      </svg>
    ),
  },
  {
    href: '/student/book',
    label: 'Book',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path d="M12.75 12.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM7.5 15.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM8.25 17.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM9.75 15.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM10.5 17.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM12 15.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM12.75 17.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM14.25 15.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM15 17.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM16.5 15.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM15 12.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM16.5 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" />
        <path fillRule="evenodd" d="M6.75 2.25A.75.75 0 0 1 7.5 3v1.5h9V3A.75.75 0 0 1 18 3v1.5h.75a3 3 0 0 1 3 3v11.25a3 3 0 0 1-3 3H5.25a3 3 0 0 1-3-3V7.5a3 3 0 0 1 3-3H6V3a.75.75 0 0 1 .75-.75Zm13.5 9a1.5 1.5 0 0 0-1.5-1.5H5.25a1.5 1.5 0 0 0-1.5 1.5v7.5a1.5 1.5 0 0 0 1.5 1.5h13.5a1.5 1.5 0 0 0 1.5-1.5v-7.5Z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    href: '/student/bookings',
    label: 'My Lessons',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path fillRule="evenodd" d="M6.32 2.577a49.255 49.255 0 0 1 11.36 0c1.497.174 2.57 1.46 2.57 2.93V21a.75.75 0 0 1-1.085.67L12 18.089l-7.165 3.583A.75.75 0 0 1 3.75 21V5.507c0-1.47 1.073-2.756 2.57-2.93Z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    href: '/student/packages',
    label: 'Packages',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path d="M4.5 3.75a3 3 0 0 0-3 3v.75h21v-.75a3 3 0 0 0-3-3h-15Z" />
        <path fillRule="evenodd" d="M22.5 9.75h-21v7.5a3 3 0 0 0 3 3h15a3 3 0 0 0 3-3v-7.5Zm-18 3.75a.75.75 0 0 1 .75-.75h6a.75.75 0 0 1 0 1.5h-6a.75.75 0 0 1-.75-.75Zm.75 2.25a.75.75 0 0 0 0 1.5h3a.75.75 0 0 0 0-1.5h-3Z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    href: '/student/shop',
    label: 'Shop',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path fillRule="evenodd" d="M7.5 6v.75H5.513c-.96 0-1.764.724-1.865 1.679l-1.263 12A1.875 1.875 0 0 0 4.25 22.5h15.5a1.875 1.875 0 0 0 1.865-2.071l-1.263-12a1.875 1.875 0 0 0-1.865-1.679H16.5V6a4.5 4.5 0 1 0-9 0ZM12 3a3 3 0 0 0-3 3v.75h6V6a3 3 0 0 0-3-3Zm-3 8.25a3 3 0 1 0 6 0v-.75a.75.75 0 0 1 1.5 0v.75a4.5 4.5 0 1 1-9 0v-.75a.75.75 0 0 1 1.5 0v.75Z" clipRule="evenodd" />
      </svg>
    ),
  },
]

interface School { id: string; name: string; city: string; country: string }

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [totalCredits, setTotalCredits] = useState<number | null>(null)
  const [currentSchool, setCurrentSchool] = useState<School | null | undefined>(undefined)
  const [schoolModalOpen, setSchoolModalOpen] = useState(false)

  useEffect(() => {
    fetch('/api/student/credits')
      .then((r) => r.json())
      .then((d) => setTotalCredits(d.totalCredits ?? 0))
      .catch(() => setTotalCredits(0))
  }, [pathname])

  // On mount: check if student has a school — if not, open modal
  useEffect(() => {
    fetch('/api/student/school')
      .then(r => r.json())
      .then(d => {
        const school = d.school ?? null
        setCurrentSchool(school)
        if (!school) setSchoolModalOpen(true)
      })
      .catch(() => setCurrentSchool(null))
  }, [])

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20 md:pb-0 md:flex">
      <InstallPWAPrompt />
      <SchoolSelectModal
        open={schoolModalOpen}
        currentSchoolId={currentSchool?.id}
        onSaved={(school) => { setCurrentSchool(school); setSchoolModalOpen(false) }}
      />

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
        {/* Top header bar */}
        <div className="sticky top-0 z-40 bg-white/80 backdrop-blur border-b border-gray-100 px-4 md:px-8 py-3 flex items-center justify-between">
          {/* Mobile: brand */}
          <span className="md:hidden text-[#6B1F3A] font-bold text-base">No Under 40</span>
          {/* Desktop: page context or empty */}
          <span className="hidden md:block" />
          {/* Credits chip */}
          <Link
            href="/student/packages"
            className="flex items-center gap-1.5 bg-[#6B1F3A]/8 hover:bg-[#6B1F3A]/15 transition px-3 py-1.5 rounded-full"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-[#6B1F3A]">
              <path d="M1 8.25a1.25 1.25 0 1 1 2.5 0v7.5a1.25 1.25 0 1 1-2.5 0v-7.5ZM11 3V1.7c0-.268.14-.526.395-.607A2 2 0 0 1 14 3c0 .995-.182 1.948-.514 2.826-.204.54.166 1.174.744 1.174h2.52c1.243 0 2.261 1.01 2.146 2.247a23.864 23.864 0 0 1-1.341 5.974C17.153 16.323 16.072 17 14.9 17H9c-1.381 0-2.5-1.12-2.5-2.5V8c0-.656.26-1.286.728-1.75L9.5 3.5C9.872 3.127 10.5 3 11 3Z" />
            </svg>
            <span className="text-sm font-semibold text-[#6B1F3A]">
              {totalCredits === null ? '—' : totalCredits}
            </span>
            <span className="text-xs text-[#6B1F3A]/70 font-medium">credits</span>
          </Link>
        </div>

        <div className="p-4 md:p-8 pb-20 md:pb-8">{children}</div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-100 flex">
        {bottomNavItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex-1 flex flex-col items-center gap-1 py-2 text-[10px] transition ${
              pathname === item.href
                ? 'text-[#6B1F3A] font-medium'
                : 'text-gray-400'
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  )
}
