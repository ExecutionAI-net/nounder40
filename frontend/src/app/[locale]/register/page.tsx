'use client'

import { useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/navigation'
import { useAuth } from '@/lib/api/auth-context'
import { ApiError } from '@/lib/api/client'
import PhoneInput from '@/components/ui/PhoneInput'
import BrandLogo from '@/components/BrandLogo'
import PasswordInput from '@/components/ui/PasswordInput'
import { countryName } from '@/lib/country-name'

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
  const [step, setStep] = useState<'profile' | 'account'>('profile')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [profile, setProfile] = useState({ name: '', phone: '', date_of_birth: '', city: '', country: 'IT' })
  const [account, setAccount] = useState({ email: '', password: '' })

  function handleProfileNext() {
    if (!profile.name) { setError(t('fullNameRequired')); return }
    setError(null)
    setStep('account')
  }

  async function handleRegister() {
    if (!account.email) { setError(t('emailRequired')); return }
    if (!account.password) { setError(t('passwordRequired')); return }
    setLoading(true)
    setError(null)

    try {
      await register({
        email: account.email,
        password: account.password,
        full_name: profile.name,
        phone: profile.phone || undefined,
        date_of_birth: profile.date_of_birth || undefined,
        city: profile.city || undefined,
        country: profile.country,
      })
      router.push('/student/dashboard')
    } catch (err) {
      const msg = err instanceof ApiError && typeof err.body === 'object' && err.body
        ? Object.values(err.body as Record<string, unknown>).flat().join(' ')
        : t('registrationFailed')
      setError(
        msg.toLowerCase().includes('already exists') ? t('accountExists') : msg || t('registrationFailed')
      )
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

        <div className="bg-white rounded-2xl border border-gray-100 p-8">
          {/* Step indicator */}
          <div className="flex items-center mb-6">
            {[0, 1].map((i) => {
              const idx = step === 'profile' ? 0 : 1
              return (
                <div key={i} className="flex items-center flex-1 last:flex-none">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium shrink-0 ${
                    i < idx ? 'bg-[#6B1F3A] text-white' :
                    i === idx ? 'bg-[#6B1F3A] text-white' :
                    'bg-gray-100 text-gray-400'
                  }`}>
                    {i < idx ? '✓' : i + 1}
                  </div>
                  {i < 1 && <div className={`h-0.5 flex-1 mx-2 ${i < idx ? 'bg-[#6B1F3A]' : 'bg-gray-200'}`} />}
                </div>
              )
            })}
          </div>

          {error && <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}

          {/* Step 1: Profile */}
          {step === 'profile' && (
            <div className="space-y-4">
              <h2 className="text-base font-semibold text-gray-800 mb-4">{t('yourProfile')}</h2>
              <div>
                <label className={labelCls}>{t('fullNameLabel')}</label>
                <input value={profile.name} onChange={e => setProfile(p => ({ ...p, name: e.target.value }))} className={inputCls} placeholder={t('fullNamePlaceholder')} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{t('phoneLabel')}</label>
                  <PhoneInput value={profile.phone} onChange={phone => setProfile(p => ({ ...p, phone }))} inputClassName={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{t('dateOfBirthLabel')}</label>
                  <input type="date" value={profile.date_of_birth} onChange={e => setProfile(p => ({ ...p, date_of_birth: e.target.value }))} className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{t('cityLabel')}</label>
                  <input value={profile.city} onChange={e => setProfile(p => ({ ...p, city: e.target.value }))} className={inputCls} placeholder={t('cityPlaceholder')} />
                </div>
                <div>
                  <label className={labelCls}>{t('countryLabel')}</label>
                  <select value={profile.country} onChange={e => setProfile(p => ({ ...p, country: e.target.value }))} className={inputCls}>
                    {countryOptions.map(c => (
                      <option key={c.code} value={c.code}>{c.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button onClick={handleProfileNext} className="w-full py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition mt-2">
                {t('continueButton')}
              </button>
            </div>
          )}

          {/* Step 2: Account */}
          {step === 'account' && (
            <div className="space-y-4">
              <h2 className="text-base font-semibold text-gray-800 mb-4">{t('accountDetails')}</h2>
              <div>
                <label className={labelCls}>{t('emailLabel')}</label>
                <input type="email" value={account.email} onChange={e => setAccount(a => ({ ...a, email: e.target.value }))} className={inputCls} placeholder={t('emailPlaceholder')} />
              </div>
              <div>
                <label className={labelCls}>{t('passwordLabel')}</label>
                <PasswordInput value={account.password} onChange={e => setAccount(a => ({ ...a, password: e.target.value }))} className={inputCls} placeholder={t('passwordPlaceholder')} />
              </div>
              <div className="flex gap-3 mt-2">
                <button onClick={() => { setStep('profile'); setError(null) }} className="px-4 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition">
                  {t('backButton')}
                </button>
                <button onClick={handleRegister} disabled={loading} className="flex-1 py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] disabled:opacity-50 transition">
                  {loading ? t('creatingAccount') : t('createAccount')}
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-sm text-gray-500 mt-4">
          {t('alreadyHaveAccount')}{' '}
          <Link href="/login" className="text-[#6B1F3A] font-medium hover:underline">{t('signIn')}</Link>
        </p>
      </div>
    </div>
  )
}
