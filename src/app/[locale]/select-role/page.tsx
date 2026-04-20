'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const ROLE_LABELS: Record<string, string> = {
  hq: 'HQ Panel',
  school: 'School Panel',
  teacher: 'Teacher Panel',
  student: 'Student Panel',
}

const ROLE_DESCRIPTIONS: Record<string, string> = {
  hq: 'Manage the network, schools, and platform settings',
  school: 'Manage your school, lessons, and students',
  teacher: 'View your schedule and mark attendance',
  student: 'Book lessons and manage your packages',
}

const ROLE_ICONS: Record<string, string> = {
  hq: '🏛️',
  school: '🏫',
  teacher: '👨‍🏫',
  student: '🎓',
}

export default function SelectRolePage() {
  const router = useRouter()
  const supabase = createClient()
  const [roles, setRoles] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: profile } = await supabase
        .from('profiles')
        .select('name, roles, role')
        .eq('id', user.id)
        .single()

      if (!profile) { router.push('/login'); return }

      setName(profile.name ?? '')
      const userRoles: string[] = profile.roles?.length ? profile.roles : [profile.role]

      if (userRoles.length <= 1) {
        router.replace(`/${userRoles[0] ?? 'student'}/dashboard`)
        return
      }

      setRoles(userRoles)
      setLoading(false)
    }
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleSelect(role: string) {
    router.push(`/${role}/dashboard`)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-sm text-gray-400">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-[#6B1F3A]">No Under 40</h1>
          <p className="text-gray-500 text-sm mt-1">Welcome back, {name || 'there'}</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-1">Select your dashboard</h2>
          <p className="text-sm text-gray-400 mb-5">Your account has access to multiple areas.</p>

          <div className="space-y-3">
            {roles.map((role) => (
              <button
                key={role}
                onClick={() => handleSelect(role)}
                className="w-full flex items-center gap-4 p-4 rounded-xl border border-gray-200 hover:border-[#6B1F3A]/30 hover:bg-[#6B1F3A]/5 transition text-left group"
              >
                <span className="text-2xl">{ROLE_ICONS[role] ?? '👤'}</span>
                <div className="flex-1">
                  <p className="font-medium text-gray-900 text-sm group-hover:text-[#6B1F3A]">
                    {ROLE_LABELS[role] ?? role}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{ROLE_DESCRIPTIONS[role] ?? ''}</p>
                </div>
                <svg className="w-4 h-4 text-gray-300 group-hover:text-[#6B1F3A]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
