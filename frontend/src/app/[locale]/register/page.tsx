'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import Image from 'next/image'
import { Link, useRouter } from '@/navigation'
import AuthSplit from '@/components/auth/AuthSplit'
import { useAuth } from '@/lib/api/auth-context'
import { ApiError, apiFetch } from '@/lib/api/client'
import PhoneInput from '@/components/ui/PhoneInput'
import BrandLogo from '@/components/BrandLogo'
import PasswordInput from '@/components/ui/PasswordInput'
import { passwordProblem } from '@/lib/password'
import { useGoogleIdentity } from '@/lib/useGoogleIdentity'

// Solo percorsi interni: un "next" esterno sarebbe un open redirect
function safeNext(raw: string | null): string {
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/student/dashboard'
}

const inputCls =
  'w-full rounded-lg border border-au-outline-variant bg-au-surface-container-lowest px-3.5 py-2.5 text-sm text-au-on-surface placeholder:text-au-outline focus:border-au-primary-container focus:outline-none focus:ring-4 focus:ring-au-secondary-container/40'
const labelCls = 'block text-sm font-medium text-au-on-surface'

/** Pannello sinistro (foto + citazione): quello che si vede solo su desktop. */
function RegisterVisual() {
  const t = useTranslations('auth.register')
  return (
    <>
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-au-surface/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] backdrop-blur-sm">
            {t('topKicker')}
          </span>
          <span className="text-xs font-medium uppercase tracking-[0.1em] text-au-surface/70">
            {t('topCities')}
          </span>
        </div>

        <div className="mt-16">
          <span className="rounded-full bg-au-tertiary-container/25 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-au-tertiary-container">
            {t('badge')}
          </span>
          <p className="mt-5 font-display text-3xl italic leading-tight xl:text-[40px] xl:leading-[1.15]">
            &ldquo;{t('quote')}&rdquo;
          </p>
          <p className="mt-4 max-w-sm text-sm leading-6 text-au-surface/75">{t('quoteBody')}</p>
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-au-surface/15 pt-6">
        <Image src="/images/founder.webp" alt="" width={96} height={96}
          className="h-12 w-12 rounded-full object-cover object-top" />
        <div>
          <p className="font-display text-base font-semibold">Alina Quintana</p>
          <p className="text-xs text-au-surface/70">{t('founderRole')}</p>
        </div>
      </div>
    </>
  )
}

export default function RegisterPage() {
  const t = useTranslations('auth.register')
  const locale = useLocale()
  const router = useRouter()
  const { register, loginWithGoogle } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Chi arriva da "Prenota" torna alla lezione da cui è partita e viene
  // iscritta subito alla scuola di quella lezione (school_id nel next).
  const [next, setNext] = useState('/student/dashboard')
  const [schoolId, setSchoolId] = useState<string | null>(null)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const target = safeNext(params.get('next'))
    setNext(target)
    const inner = new URLSearchParams(target.split('?')[1] ?? '')
    setSchoolId(inner.get('school_id') ?? inner.get('school'))
  }, [])

  async function finish() {
    if (schoolId) {
      await apiFetch('/student/school/', { method: 'POST', body: JSON.stringify({ school_id: schoolId }) }).catch(() => {})
    }
    router.push(next)
  }

  const { prompt: promptGoogle, enabled: googleEnabled } = useGoogleIdentity(async (idToken) => {
    setLoading(true)
    setError(null)
    try {
      await loginWithGoogle(idToken, locale)
      await finish()
    } catch {
      setError(t('registrationFailed'))
      setLoading(false)
    }
  })

  // Un modulo solo (scelta di Carlo): i due passi nascondevano metà dei
  // campi e non si capiva quanto mancasse. Città e paese non servono qui:
  // l'allieva si lega a una scuola, e restano modificabili nel profilo.
  const [form, setForm] = useState({
    first_name: '', last_name: '', phone: '',
    email: '', password: '', confirm: '',
  })
  const set = (patch: Partial<typeof form>) => setForm(f => ({ ...f, ...patch }))

  async function handleRegister(e: FormEvent) {
    e.preventDefault()
    if (!form.first_name.trim()) { setError(t('firstNameRequired')); return }
    if (!form.last_name.trim()) { setError(t('lastNameRequired')); return }
    // il valore include il prefisso: 8 cifre = prefisso + un numero vero
    if (form.phone.replace(/\D/g, '').length < 8) { setError(t('phoneRequired')); return }
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) { setError(t('emailRequired')); return }
    const problem = passwordProblem(form.password)
    if (problem) { setError(t(problem === 'short' ? 'passwordTooShort' : 'passwordWeak')); return }
    if (form.password !== form.confirm) { setError(t('passwordMismatch')); return }
    setLoading(true)
    setError(null)

    try {
      await register({
        email: form.email.trim(),
        password: form.password,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        full_name: `${form.first_name.trim()} ${form.last_name.trim()}`,
        phone: form.phone,
        // la lingua dell'interfaccia in cui si è registrata, come la barra laterale
        language_preference: locale,
      })
      await finish()
    } catch (err) {
      const msg = err instanceof ApiError && typeof err.body === 'object' && err.body
        ? Object.values(err.body as Record<string, unknown>).flat().join(' ')
        : t('registrationFailed')
      setError(msg)
      setLoading(false)
    }
  }

  return (
    <AuthSplit imageSrc="/images/leap.jpg" imageAlt="" visual={<RegisterVisual />}>
      <div className="mb-6 text-center">
        <BrandLogo className="mx-auto h-14" />
      </div>

      <h1 className="font-display text-2xl font-semibold text-au-on-surface">{t('formTitle')}</h1>
      <p className="mt-1.5 text-sm text-au-on-surface-variant">{t('subtitle')}</p>

      <form onSubmit={handleRegister} className="mt-6 space-y-4">
        {error && <div className="rounded-lg bg-au-error-container p-3 text-sm text-au-on-error-container">{error}</div>}

        {googleEnabled && (
          <>
            <button type="button" onClick={() => { setLoading(true); promptGoogle() }} disabled={loading}
              className="flex w-full items-center justify-center gap-3 rounded-lg border border-au-outline-variant bg-au-surface-container-low px-4 py-3 text-sm font-medium text-au-on-surface transition hover:bg-au-surface-container disabled:opacity-50">
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              {t('continueWithGoogle')}
            </button>
            <div className="relative py-1">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-au-outline-variant" /></div>
              <div className="relative flex justify-center"><span className="bg-au-surface-container-lowest px-3 text-xs uppercase tracking-wide text-au-outline">{t('orWithEmail')}</span></div>
            </div>
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={`${labelCls} mb-1.5`}>{t('firstNameLabel')} *</label>
            <input value={form.first_name} onChange={e => set({ first_name: e.target.value })} className={inputCls} placeholder="Maria" autoComplete="given-name" />
          </div>
          <div>
            <label className={`${labelCls} mb-1.5`}>{t('lastNameLabel')} *</label>
            <input value={form.last_name} onChange={e => set({ last_name: e.target.value })} className={inputCls} placeholder="Rossi" autoComplete="family-name" />
          </div>
        </div>
        {/* Telefono su riga intera: prefisso + numero in mezza colonna
            lasciavano al numero una manciata di cifre visibili */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className={labelCls}>{t('phoneLabel')} *</label>
            <span className="text-xs text-au-outline">{t('phoneHint')}</span>
          </div>
          <PhoneInput value={form.phone} onChange={phone => set({ phone })} inputClassName={inputCls}
            selectClassName="shrink-0 rounded-lg border border-au-outline-variant bg-au-surface-container-lowest px-2 py-2.5 text-sm text-au-on-surface focus:border-au-primary-container focus:outline-none focus:ring-4 focus:ring-au-secondary-container/40" />
        </div>
        {/* Data di nascita rimossa dalla registrazione: si compila nel tab
            Documenti del profilo (BirthDateField) — un campo in meno qui */}
        <div>
          <label className={`${labelCls} mb-1.5`}>{t('emailLabel')} *</label>
          <input type="email" value={form.email} onChange={e => set({ email: e.target.value })} className={inputCls} placeholder={t('emailPlaceholder')} autoComplete="email" />
        </div>
        <div>
          {/* Il vincolo va sotto il campo, non accanto all'etichetta: in
              coppia con "Password *" non ci stava su una riga sola nei
              375px del mobile ed è andato a capo in un modo confuso. */}
          <label className={`${labelCls} mb-1.5`}>{t('passwordLabel')} *</label>
          <PasswordInput value={form.password} onChange={e => set({ password: e.target.value })} className={inputCls} placeholder={t('passwordPlaceholder')} autoComplete="new-password" />
          <p className="mt-1 text-xs text-au-outline">{t('passwordRule')}</p>
        </div>
        <div>
          <label className={`${labelCls} mb-1.5`}>{t('confirmPasswordLabel')} *</label>
          <PasswordInput value={form.confirm} onChange={e => set({ confirm: e.target.value })} className={inputCls} placeholder={t('passwordPlaceholder')} autoComplete="new-password" />
          {form.confirm && form.confirm !== form.password && <p className="mt-1 text-xs text-au-error">{t('passwordMismatch')}</p>}
        </div>

        <button type="submit" disabled={loading}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-au-primary-container py-3 text-sm font-semibold text-au-on-primary transition hover:bg-au-primary disabled:opacity-50">
          {loading ? t('creatingAccount') : t('createAccount')}
          {!loading && <span aria-hidden>→</span>}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-au-on-surface-variant">
        {t('alreadyHaveAccount')}{' '}
        <Link href="/login" className="font-semibold text-au-primary-container hover:underline">{t('signIn')}</Link>
      </p>
    </AuthSplit>
  )
}
