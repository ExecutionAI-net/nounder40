'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/navigation'
import { useAuth } from '@/lib/api/auth-context'
import { ApiError } from '@/lib/api/client'
import PhoneInput from '@/components/ui/PhoneInput'
import BrandLogo from '@/components/BrandLogo'
import PasswordInput from '@/components/ui/PasswordInput'
import { countryName } from '@/lib/country-name'
import { passwordProblem } from '@/lib/password'

// I codici restano quelli salvati sul profilo; cambia solo l'etichetta, che
// il browser traduce nella lingua dell'interfaccia (Intl.DisplayNames): niente
// lista di nomi da mantenere in cinque lingue, e nessun inglese davanti a
// un'utente italiana. Ordinati come si leggono nella sua lingua — "Regno
// Unito" sta sotto la R, non sotto la U.
const COUNTRY_CODES = ['IT', 'FR', 'ES', 'DE', 'GB', 'US', 'TR'] as const

const COUNTRY_FALLBACK: Record<string, string> = {
  IT: 'Italy', FR: 'France', ES: 'Spain', DE: 'Germany',
  GB: 'United Kingdom', US: 'United States', TR: 'Türkiye',
}

function countryLabels(locale: string) {
  return COUNTRY_CODES
    .map(code => ({ code, label: countryName(code, locale, COUNTRY_FALLBACK[code]) }))
    .sort((a, b) => a.label.localeCompare(b.label, locale))
}

export default function RegisterPage() {
  const t = useTranslations('auth.register')
  const locale = useLocale()
  const countryOptions = useMemo(() => countryLabels(locale), [locale])
  const router = useRouter()
  const { register } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Un modulo solo (scelta di Carlo): i due passi nascondevano metà dei
  // campi e non si capiva quanto mancasse.
  const [form, setForm] = useState({
    first_name: '', last_name: '', phone: '', date_of_birth: '', city: '', country: 'IT',
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
        date_of_birth: form.date_of_birth || undefined,
        city: form.city || undefined,
        country: form.country,
      })
      router.push('/student/dashboard')
    } catch (err) {
      const msg = err instanceof ApiError && typeof err.body === 'object' && err.body
        ? Object.values(err.body as Record<string, unknown>).flat().join(' ')
        : t('registrationFailed')
      setError(msg)
      setLoading(false)
    }
  }

  const inputCls = 'w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20'
  const labelCls = 'block text-sm font-medium text-gray-700 mb-1'

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <BrandLogo className="h-14" />
          <p className="text-gray-500 text-sm mt-1">{t('subtitle')}</p>
        </div>

        <form onSubmit={handleRegister} className="bg-white rounded-2xl border border-gray-100 p-8 space-y-4">
          {error && <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}

          <h2 className="text-base font-semibold text-gray-800">{t('yourProfile')}</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{t('firstNameLabel')} *</label>
              <input value={form.first_name} onChange={e => set({ first_name: e.target.value })} className={inputCls} placeholder="Maria" autoComplete="given-name" />
            </div>
            <div>
              <label className={labelCls}>{t('lastNameLabel')} *</label>
              <input value={form.last_name} onChange={e => set({ last_name: e.target.value })} className={inputCls} placeholder="Rossi" autoComplete="family-name" />
            </div>
          </div>
          {/* Telefono su riga intera: prefisso + numero in mezza colonna
              lasciavano al numero una manciata di cifre visibili */}
          <div>
            <label className={labelCls}>{t('phoneLabel')} *</label>
            <PhoneInput value={form.phone} onChange={phone => set({ phone })} inputClassName={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{t('dateOfBirthLabel')}</label>
              <input type="date" value={form.date_of_birth} onChange={e => set({ date_of_birth: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t('cityLabel')}</label>
              <input value={form.city} onChange={e => set({ city: e.target.value })} className={inputCls} placeholder={t('cityPlaceholder')} />
            </div>
          </div>
          <div>
            <label className={labelCls}>{t('countryLabel')}</label>
            <select value={form.country} onChange={e => set({ country: e.target.value })} className={inputCls}>
              {countryOptions.map(c => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
          </div>

          <h2 className="text-base font-semibold text-gray-800 pt-2">{t('accountDetails')}</h2>
          <div>
            <label className={labelCls}>{t('emailLabel')} *</label>
            <input type="email" value={form.email} onChange={e => set({ email: e.target.value })} className={inputCls} placeholder={t('emailPlaceholder')} autoComplete="email" />
          </div>
          <div>
            <label className={labelCls}>{t('passwordLabel')} *</label>
            <PasswordInput value={form.password} onChange={e => set({ password: e.target.value })} className={inputCls} placeholder={t('passwordPlaceholder')} />
            <p className="text-xs text-gray-400 mt-1">{t('passwordRule')}</p>
          </div>
          <div>
            <label className={labelCls}>{t('confirmPasswordLabel')} *</label>
            <PasswordInput value={form.confirm} onChange={e => set({ confirm: e.target.value })} className={inputCls} placeholder={t('passwordPlaceholder')} />
            {form.confirm && form.confirm !== form.password && <p className="text-xs text-red-500 mt-1">{t('passwordMismatch')}</p>}
          </div>

          <button type="submit" disabled={loading} className="w-full py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] disabled:opacity-50 transition mt-2">
            {loading ? t('creatingAccount') : t('createAccount')}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-4">
          {t('alreadyHaveAccount')}{' '}
          <Link href="/login" className="text-[#6B1F3A] font-medium hover:underline">{t('signIn')}</Link>
        </p>
      </div>
    </div>
  )
}
