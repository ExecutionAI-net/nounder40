'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function SetupAccountPage() {
  const router = useRouter()
  const supabase = createClient()
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [redirectTo, setRedirectTo] = useState('/hq/dashboard')

  useEffect(() => {
    async function initWithUser(userId: string, userEmail: string, userMeta: Record<string, string>) {
      const meta = userMeta ?? {}
      setName(meta.name ?? meta.full_name ?? '')

      const { data: profile } = await supabase.from('profiles').select('role, roles, name').eq('id', userId).single()
      const roles: string[] = profile?.roles?.length ? profile.roles : (profile?.role ? [profile.role] : [])
      if (profile?.name && !meta.name && !meta.full_name) {
        setName(profile.name)
      }
      if (roles.length > 1) {
        setRedirectTo('/select-role')
      } else {
        setRedirectTo(`/${profile?.role ?? 'school'}/dashboard`)
      }
      setChecking(false)
    }

    // Use onAuthStateChange to handle both existing sessions and hash-based magic link tokens
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        subscription.unsubscribe()
        await initWithUser(session.user.id, session.user.email ?? '', session.user.user_metadata ?? {})
      } else if (event === 'SIGNED_OUT' || event === 'INITIAL_SESSION') {
        // No session — check one more time with getUser in case session exists in cookie
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          router.replace('/login')
        } else {
          subscription.unsubscribe()
          await initWithUser(user.id, user.email ?? '', user.user_metadata ?? {})
        }
      }
    })

    return () => subscription.unsubscribe()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Please enter your name.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }

    setLoading(true)
    setError(null)

    const { error: pwError } = await supabase.auth.updateUser({ password })
    if (pwError) { setError(pwError.message); setLoading(false); return }

    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await supabase.from('profiles').update({ name: name.trim() }).eq('id', user.id)
      // Process any pending invitations (e.g. teacher invites for existing auth users)
      await fetch('/api/account/process-invite', { method: 'POST' }).catch(() => {})
    }

    router.replace(redirectTo)
  }

  if (checking) {
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
          <p className="text-gray-500 text-sm mt-1">Set up your account</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-8">
          <h2 className="text-base font-semibold text-gray-800 mb-1">Welcome!</h2>
          <p className="text-sm text-gray-400 mb-6">Please set your name and create a password to get started.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                placeholder="Your full name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                placeholder="Min. 8 characters"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password *</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                placeholder="Repeat password"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] disabled:opacity-50 transition mt-2"
            >
              {loading ? 'Setting up...' : 'Complete Setup →'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
