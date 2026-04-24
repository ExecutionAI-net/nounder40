'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from '@/navigation'

export default function ResetPasswordPage() {
  const t = useTranslations('auth.resetPassword')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function init() {
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')

      // Existing session (came back to page after already exchanging)
      const { data: existing } = await supabase.auth.getSession()
      if (existing.session) {
        setReady(true)
        return
      }

      // PKCE code in URL — exchange it for a session
      if (code) {
        const { error: exErr } = await supabase.auth.exchangeCodeForSession(code)
        if (exErr) {
          console.error('[reset-password] exchange error:', exErr.message)
          setError(`Reset link invalid or expired: ${exErr.message}`)
          return
        }
        // Clear the code from the URL so refresh doesn't try to re-use it
        window.history.replaceState({}, '', window.location.pathname)
        setReady(true)
        return
      }

      // Hash flow (older Supabase email template puts access_token in #)
      if (window.location.hash.includes('access_token')) {
        // supabase-js picks it up automatically; wait a tick then re-check
        await new Promise(r => setTimeout(r, 300))
        const { data } = await supabase.auth.getSession()
        if (data.session) { setReady(true); return }
      }

      setError('No active reset link. Request a new one from the login page.')
    }
    init()
  }, [supabase, router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 6) { setError(t('passwordTooShort')); return }
    if (password !== confirm) { setError(t('passwordMismatch')); return }

    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
      router.replace(`/${profile?.role ?? 'student'}/dashboard`)
    } else {
      router.replace('/login')
    }
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        {error ? (
          <div className="w-full max-w-md p-6 bg-white rounded-2xl border border-gray-100 text-center space-y-4">
            <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-sm text-gray-700">{error}</p>
            <button
              onClick={() => router.replace('/login')}
              className="text-sm text-[#6B1F3A] font-medium hover:underline"
            >
              Back to login
            </button>
          </div>
        ) : (
          <div className="w-8 h-8 border-2 border-[#6B1F3A] border-t-transparent rounded-full animate-spin" />
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md p-8 bg-white rounded-2xl shadow-sm border border-gray-100 space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-[#6B1F3A]">No Under 40</h1>
          <p className="mt-2 text-sm text-gray-500">{t('title')}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('newPasswordLabel')}</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]"
              placeholder={t('newPasswordPlaceholder')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('confirmPasswordLabel')}</label>
            <input
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]"
              placeholder={t('confirmPasswordPlaceholder')}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 bg-[#6B1F3A] text-white rounded-xl text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
          >
            {loading ? t('saving') : t('saveButton')}
          </button>
        </form>
      </div>
    </div>
  )
}
