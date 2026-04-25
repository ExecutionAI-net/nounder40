'use client'

import { useState, useEffect, Suspense } from 'react' // eslint-disable-line @typescript-eslint/no-unused-vars
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { useSearchParams } from 'next/navigation'
import { Link, useRouter } from '@/navigation'

type Mode = 'login' | 'forgot' | 'forgot-sent'

function LoginForm() {
  const t = useTranslations('auth.login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('login')
  const searchParams = useSearchParams()
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    if (searchParams.get('reset') === 'success') {
      setSuccess(t('passwordUpdated'))
    }
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error, data } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, roles')
      .eq('id', data.user.id)
      .single()

    if (profileError) {
      setError(t('failedProfile'))
      setLoading(false)
      return
    }

    const roles: string[] = profile?.roles?.length ? profile.roles : [profile?.role ?? 'student']
    const next = searchParams.get('next')
    if (roles.length > 1) {
      router.refresh()
      router.push('/select-role')
      return
    }
    const role = roles[0]
    const isSafeNext = next && next.startsWith('/') && !next.startsWith('//') && next !== '/' && !next.startsWith('/login')
    const destination = isSafeNext ? next : `/${role}/dashboard`
    router.refresh()
    router.push(destination)
  }

  async function handleGoogleLogin() {
    setLoading(true)
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const res = await fetch('/api/auth/send-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, origin: window.location.origin }),
    })
    const data = await res.json()

    if (!res.ok) {
      setError(data.error ?? t('failedResetEmail'))
      setLoading(false)
      return
    }

    setMode('forgot-sent')
    setLoading(false)
  }

  if (mode === 'forgot' || mode === 'forgot-sent') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-full max-w-md space-y-8 p-8 bg-white rounded-2xl shadow-sm border border-gray-100">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-[#6B1F3A]">No Under 40</h1>
            <p className="mt-2 text-sm text-gray-500">
              {mode === 'forgot' ? t('resetPassword') : t('checkEmail')}
            </p>
          </div>

          {mode === 'forgot-sent' ? (
            <div className="space-y-4 text-center">
              <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-sm text-gray-600">
                {t('resetEmailSent', { email: <strong>{email}</strong> })}
              </p>
              <button
                onClick={() => { setMode('login'); setError(null) }}
                className="text-sm text-[#6B1F3A] font-medium hover:underline"
              >
                {t('backToLogin')}
              </button>
            </div>
          ) : (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              {error && (
                <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>
              )}
              <div>
                <label htmlFor="forgot-email" className="block text-sm font-medium text-gray-700 mb-1">{t('emailLabel')}</label>
                <input
                  id="forgot-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]"
                  placeholder="you@example.com"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 bg-[#6B1F3A] text-white rounded-xl text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
              >
                {loading ? t('sending') : t('sendResetLink')}
              </button>
              <button
                type="button"
                onClick={() => { setMode('login'); setError(null) }}
                className="w-full text-sm text-gray-500 hover:text-gray-700"
              >
                {t('backToLogin')}
              </button>
            </form>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md space-y-8 p-8 bg-white rounded-2xl shadow-sm border border-gray-100">
        {/* Logo */}
        <div className="text-center">
          <h1 className="text-3xl font-bold text-[#6B1F3A]">No Under 40</h1>
          <p className="mt-2 text-sm text-gray-500">{t('signIn')}</p>
        </div>

        {/* Google OAuth */}
        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition disabled:opacity-50"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          {t('continueWithGoogle')}
        </button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-100" />
          </div>
          <div className="relative flex justify-center text-xs text-gray-600">
            <span className="bg-white px-3">{t('orContinueWithEmail')}</span>
          </div>
        </div>

        {/* Email / Password */}
        <form onSubmit={handleEmailLogin} className="space-y-4">
          {success && (
            <div className="p-3 rounded-lg bg-green-50 text-green-700 text-sm">{success}</div>
          )}
          {error && (
            <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="login-email" className="block text-sm font-medium text-gray-700 mb-1">{t('emailLabel')}</label>
            <input
              id="login-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="login-password" className="block text-sm font-medium text-gray-700 mb-1">{t('passwordLabel')}</label>
            <input
              id="login-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 bg-[#6B1F3A] text-white rounded-xl text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
          >
            {loading ? t('signingIn') : t('signInButton')}
          </button>

          <div className="text-center">
            <button
              type="button"
              onClick={() => { setMode('forgot'); setError(null) }}
              className="text-sm text-[#6B1F3A] hover:underline"
            >
              {t('forgotPassword')}
            </button>
          </div>
        </form>

        <p className="text-center text-sm text-gray-500">
          {t('noAccount')}{' '}
          <Link href="/register" className="text-[#6B1F3A] font-medium hover:underline">
            {t('register')}
          </Link>
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
