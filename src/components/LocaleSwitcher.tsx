'use client'

import { useLocale } from 'next-intl'
import { locales } from '@/i18n/routing'
import { createClient } from '@/lib/supabase/client'

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
  const supabase = createClient()

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newLocale = e.target.value
    if (newLocale === locale) return

    // Save to cookie (read by middleware)
    document.cookie = `user_locale=${newLocale};path=/;max-age=${60 * 60 * 24 * 365};SameSite=Lax`

    // Save to Supabase profile (best-effort, don't block navigation)
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      supabase.from('profiles').update({ language_preference: newLocale }).eq('id', user.id).then(() => {})
    }

    // Navigate to same path with new locale
    const currentPath = window.location.pathname
    const localePattern = new RegExp(`^/(${locales.join('|')})(/.*)`)
    const match = currentPath.match(localePattern)
    const pathWithoutLocale = match ? match[2] : currentPath
    window.location.href = `/${newLocale}${pathWithoutLocale}`
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
