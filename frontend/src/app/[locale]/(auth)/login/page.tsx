'use client'

import { useState, useEffect, Suspense } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { Link, useRouter } from '@/navigation'
import BrandLogo from '@/components/BrandLogo'
import AuthSplit from '@/components/auth/AuthSplit'
import { useAuth } from '@/lib/api/auth-context'
import { apiFetch } from '@/lib/api/client'
import { useGoogleIdentity } from '@/lib/useGoogleIdentity'
import PasswordInput from '@/components/ui/PasswordInput'

type Mode = 'login' | 'forgot' | 'forgot-sent'

const inputCls =
  'w-full rounded-lg border border-au-outline-variant bg-au-surface-container-lowest px-4 py-3 text-sm text-au-on-surface placeholder:text-au-outline focus:border-au-primary-container focus:outline-none focus:ring-4 focus:ring-au-secondary-container/40'
const labelCls = 'block text-sm font-medium text-au-on-surface'

function LockIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
    </svg>
  )
}

function HeartIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
    </svg>
  )
}

/** Pannello sinistro (foto + citazione): quello che si vede solo su desktop. */
function LoginVisual() {
  const t = useTranslations('auth.login')
  return (
    <>
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-au-surface/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] backdrop-blur-sm">
            {t('panelBadge')}
          </span>
          <span className="text-xs font-medium uppercase tracking-[0.1em] text-au-surface/70">
            {t('panelCities')}
          </span>
        </div>

        <div className="mt-16">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-au-secondary-container">
            {t('quoteKicker')}
          </p>
          <p className="mt-3 font-display text-3xl italic leading-tight xl:text-[40px] xl:leading-[1.15]">
            &ldquo;{t('quote')}&rdquo;
          </p>
          <p className="mt-4 max-w-sm text-sm leading-6 text-au-surface/75">{t('quoteBody')}</p>
        </div>
      </div>

      <div className="space-y-6">
        <div className="flex items-center gap-3 border-t border-au-surface/15 pt-6">
          <Image src="/images/founder.webp" alt="" width={96} height={96}
            className="h-12 w-12 rounded-full object-cover object-top" />
          <div>
            <p className="font-display text-base font-semibold">Alina Quintana</p>
            <p className="text-xs text-au-surface/70">{t('founderRole')}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-au-surface/65">
          <span className="flex items-center gap-1.5">
            <LockIcon />
            {t('encryptedAccess')}
          </span>
          <span className="flex items-center gap-1.5">
            <HeartIcon />
            {t('studentSupport')}
          </span>
        </div>
      </div>
    </>
  )
}

function LoginForm() {
  const t = useTranslations('auth.login')
  const uiLocale = useLocale()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('login')
  const searchParams = useSearchParams()
  const router = useRouter()
  const { login, loginWithGoogle } = useAuth()

  useEffect(() => {
    if (searchParams.get('reset') === 'success') {
      setSuccess(t('passwordUpdated'))
    }
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  async function redirectAfterLogin(roles: string[]) {
    const next = searchParams.get('next')
    if (roles.length > 1) {
      router.push('/select-role')
      return
    }
    const role = roles[0]
    const isSafeNext = next && next.startsWith('/') && !next.startsWith('//') && next !== '/' && !next.startsWith('/login')
    if (isSafeNext && role === 'student') {
      // Arrivata da "Prenota": la lezione porta la sua scuola (school_id nel
      // next) e l'allieva vi viene iscritta prima di tornarci
      const inner = new URLSearchParams(next.split('?')[1] ?? '')
      const schoolId = inner.get('school_id') ?? inner.get('school')
      if (schoolId) await apiFetch('/student/school/', { method: 'POST', body: JSON.stringify({ school_id: schoolId }) }).catch(() => {})
    }
    router.push(isSafeNext ? next : `/${role}/dashboard`)
  }

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const user = await login(email, password)
      const roles = user.roles?.length ? user.roles : [user.role]
      await redirectAfterLogin(roles)
    } catch {
      setError(t('failedProfile'))
      setLoading(false)
    }
  }

  const { prompt: promptGoogle, enabled: googleEnabled } = useGoogleIdentity(async (idToken) => {
    setLoading(true)
    setError(null)
    try {
      const user = await loginWithGoogle(idToken)
      const roles = user.roles?.length ? user.roles : [user.role]
      await redirectAfterLogin(roles)
    } catch {
      setError(t('failedProfile'))
      setLoading(false)
    }
  })

  function handleGoogleLogin() {
    setLoading(true)
    promptGoogle()
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      // locale: l'email di reset arriva nella lingua in cui stai navigando
      // (la preferenza salvata resta il fallback lato server)
      const data = await apiFetch<{ found?: boolean }>('/auth/password-reset/', { method: 'POST', body: JSON.stringify({ email, locale: uiLocale }) })
      if (data.found === false) {
        setError(t('emailNotFound'))
        return
      }
      setMode('forgot-sent')
    } catch {
      setError(t('failedResetEmail'))
    } finally {
      setLoading(false)
    }
  }

  if (mode === 'forgot' || mode === 'forgot-sent') {
    return (
      <AuthSplit imageSrc="/images/hero-arms.jpg" imageAlt="" visual={<LoginVisual />}>
        <div className="mb-8 text-center">
          <BrandLogo className="mx-auto h-14" />
        </div>

        <h1 className="font-display text-2xl font-semibold text-au-on-surface">
          {mode === 'forgot' ? t('resetTitle') : t('checkEmail')}
        </h1>

        {mode === 'forgot-sent' ? (
          <div className="mt-6 space-y-5 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-au-secondary-container/40">
              <svg className="h-7 w-7 text-au-primary-container" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-sm text-au-on-surface-variant">{t('resetEmailSent', { email })}</p>
            <button onClick={() => { setMode('login'); setError(null) }}
              className="text-sm font-semibold text-au-primary-container hover:underline">
              {t('backToLogin')}
            </button>
          </div>
        ) : (
          <form onSubmit={handleForgotPassword} className="mt-6 space-y-4">
            <p className="text-sm text-au-on-surface-variant">{t('resetSubtitle')}</p>
            {error && <div className="rounded-lg bg-au-error-container p-3 text-sm text-au-on-error-container">{error}</div>}
            <div>
              <label className={`${labelCls} mb-1.5`}>{t('emailLabel')}</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                className={inputCls} placeholder="nome@dominio.it" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full rounded-lg bg-au-primary-container py-3 text-sm font-semibold text-au-on-primary transition hover:bg-au-primary disabled:opacity-50">
              {loading ? t('sending') : t('sendResetLink')}
            </button>
            <button type="button" onClick={() => { setMode('login'); setError(null) }}
              className="w-full text-sm text-au-on-surface-variant hover:text-au-on-surface">
              {t('backToLogin')}
            </button>
          </form>
        )}
      </AuthSplit>
    )
  }

  return (
    <AuthSplit imageSrc="/images/hero-arms.jpg" imageAlt="" visual={<LoginVisual />}>
      <div className="mb-6 text-center">
        <BrandLogo className="mx-auto h-14" />
      </div>

      <h1 className="font-display text-2xl font-semibold text-au-on-surface">{t('welcomeTitle')}</h1>
      <p className="mt-1.5 text-sm text-au-on-surface-variant">{t('welcomeSubtitle')}</p>

      {googleEnabled && (
        <>
          <button onClick={handleGoogleLogin} disabled={loading}
            className="mt-6 flex w-full items-center justify-center gap-3 rounded-lg border border-au-outline-variant bg-au-surface-container-low px-4 py-3 text-sm font-medium text-au-on-surface transition hover:bg-au-surface-container disabled:opacity-50">
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            {t('continueWithGoogle')}
          </button>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-au-outline-variant" /></div>
            <div className="relative flex justify-center text-xs uppercase tracking-wide text-au-outline">
              <span className="bg-au-surface-container-lowest px-3">{t('orContinueWithEmail')}</span>
            </div>
          </div>
        </>
      )}

      <form onSubmit={handleEmailLogin} className={`space-y-4 ${googleEnabled ? '' : 'mt-6'}`}>
        {success && <div className="rounded-lg bg-au-secondary-container/40 p-3 text-sm text-au-primary">{success}</div>}
        {error && <div className="rounded-lg bg-au-error-container p-3 text-sm text-au-on-error-container">{error}</div>}

        <div>
          <label className={`${labelCls} mb-1.5`}>{t('emailLabel')}</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            className={inputCls} placeholder="nome@dominio.it" autoComplete="email" />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className={labelCls}>{t('passwordLabel')}</label>
            <button type="button" onClick={() => { setMode('forgot'); setError(null) }}
              className="text-xs font-medium text-au-primary-container hover:underline">
              {t('forgotPassword')}
            </button>
          </div>
          <PasswordInput required value={password} onChange={(e) => setPassword(e.target.value)}
            className={inputCls} placeholder="••••••••" autoComplete="current-password" />
        </div>

        <button type="submit" disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-au-primary-container py-3 text-sm font-semibold text-au-on-primary transition hover:bg-au-primary disabled:opacity-50">
          {loading ? t('signingIn') : t('signInButton')}
          {!loading && <span aria-hidden>→</span>}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-au-on-surface-variant">
        {t('noAccount')}{' '}
        <Link href="/register" className="font-semibold text-au-primary-container hover:underline">
          {t('register')}
        </Link>
      </p>
    </AuthSplit>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
