'use client'

import { useLocale } from 'next-intl'
import { locales } from '@/i18n/routing'
import { useAuth } from '@/lib/api/auth-context'
import { apiFetch } from '@/lib/api/client'
import { localeHref, persistLocale } from '@/lib/locale'

const LOCALE_LABELS: Record<string, string> = {
  en: '🇬🇧 EN',
  it: '🇮🇹 IT',
  es: '🇪🇸 ES',
  fr: '🇫🇷 FR',
  de: '🇩🇪 DE',
}

type Variant = 'hq' | 'dark' | 'light'

const styles: Record<Variant, string> = {
  hq: 'bg-[#5a1930] text-[#e8a0b4] border-[#5a1930] focus:ring-[#e8a0b4]/30',
  dark: 'bg-gray-800 text-gray-300 border-gray-700 focus:ring-gray-500/30',
  light: 'bg-white text-gray-600 border-gray-200 focus:ring-gray-400/30',
}

export default function LocaleSwitcher({ variant = 'dark' }: { variant?: Variant }) {
  const locale = useLocale()
  const { user } = useAuth()

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newLocale = e.target.value
    if (newLocale === locale) return

    // Read by middleware for anonymous visitors (see lib/locale).
    persistLocale(newLocale)

    // Best-effort persist to the account, don't block navigation
    if (user) {
      apiFetch('/auth/me/', {
        method: 'PATCH',
        body: JSON.stringify({ language_preference: newLocale }),
      }).catch(() => {})
    }

    // Navigate to same path with new locale
    window.location.href = localeHref(newLocale, window.location.pathname)
  }

  return (
    <select
      value={locale}
      onChange={handleChange}
      className={`w-full text-xs rounded-lg px-2 py-1.5 border cursor-pointer focus:outline-none focus:ring-2 ${styles[variant]}`}
    >
      {locales.map((l) => (
        <option key={l} value={l}>
          {LOCALE_LABELS[l]}
        </option>
      ))}
    </select>
  )
}
