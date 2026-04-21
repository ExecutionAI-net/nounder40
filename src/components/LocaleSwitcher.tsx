'use client'

import { useLocale } from 'next-intl'
import { locales } from '@/i18n/routing'
import { createClient } from '@/lib/supabase/client'

const LOCALE_LABELS: Record<string, { flag: string; label: string }> = {
  en: { flag: '🇬🇧', label: 'EN' },
  it: { flag: '🇮🇹', label: 'IT' },
  es: { flag: '🇪🇸', label: 'ES' },
  fr: { flag: '🇫🇷', label: 'FR' },
  de: { flag: '🇩🇪', label: 'DE' },
}

type Variant = 'hq' | 'dark' | 'light'

const containerStyles: Record<Variant, string> = {
  hq: 'border-[#5a1930]',
  dark: 'border-gray-700',
  light: 'border-gray-200',
}

const buttonBase: Record<Variant, string> = {
  hq: 'text-[#e8a0b4] hover:bg-[#4a1525]',
  dark: 'text-gray-300 hover:bg-white/10',
  light: 'text-gray-500 hover:bg-gray-100',
}

const buttonActive: Record<Variant, string> = {
  hq: 'bg-[#4a1525] text-white font-semibold',
  dark: 'bg-white/15 text-white font-semibold',
  light: 'bg-gray-100 text-gray-900 font-semibold',
}

export default function LocaleSwitcher({ variant = 'dark' }: { variant?: Variant }) {
  const locale = useLocale()
  const supabase = createClient()

  async function handleChange(newLocale: string) {
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
    <div className={`px-1 py-1 rounded-xl border ${containerStyles[variant]}`}>
      <div className="flex items-center gap-0.5">
        {locales.map((l) => {
          const { flag, label } = LOCALE_LABELS[l]
          const isActive = l === locale
          return (
            <button
              key={l}
              onClick={() => handleChange(l)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs transition-all ${
                isActive ? buttonActive[variant] : buttonBase[variant]
              }`}
            >
              <span>{flag}</span>
              <span>{label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
