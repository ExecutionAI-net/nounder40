'use client'

import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { locales } from '@/i18n/routing'
import { useAuth } from '@/lib/api/auth-context'
import { apiFetch } from '@/lib/api/client'
import { localeHref, persistLocale } from '@/lib/locale'

const LOCALE_META: Record<string, { flag: string; name: string }> = {
  en: { flag: '🇬🇧', name: 'English' },
  it: { flag: '🇮🇹', name: 'Italiano' },
  es: { flag: '🇪🇸', name: 'Español' },
  fr: { flag: '🇫🇷', name: 'Français' },
  de: { flag: '🇩🇪', name: 'Deutsch' },
}

type Variant = 'light' | 'dark'

// 'light': white header/top bar on every panel. 'dark': the mobile top bar on
// HQ/School/Teacher, which keeps the role's dark sidebar background.
const triggerStyles: Record<Variant, string> = {
  light: 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 shadow-sm',
  dark: 'bg-white/10 border border-white/10 text-[var(--sb-text)] hover:bg-white/20',
}

export default function LanguageDropdown({ variant = 'light', compact = false }: { variant?: Variant; compact?: boolean }) {
  const locale = useLocale()
  const t = useTranslations('header')
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  function handleSelect(newLocale: string) {
    setOpen(false)
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

  const current = LOCALE_META[locale] ?? LOCALE_META.en

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-lg text-xs font-semibold transition-colors ${compact ? 'px-2 py-1.5' : 'px-3 py-1.5'} ${triggerStyles[variant]}`}
      >
        <span className="text-base leading-none">{current.flag}</span>
        {!compact && <span className="tracking-wide">{locale.toUpperCase()}</span>}
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 opacity-60 shrink-0">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.25a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08Z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 mt-2 w-44 bg-white rounded-xl shadow-xl border border-gray-200 py-1.5 z-50 text-xs origin-top-right"
        >
          <div className="px-3 py-1.5 text-[10px] font-semibold tracking-wider text-gray-400 uppercase border-b border-gray-100">
            {t('selectLanguage')}
          </div>
          {locales.map(l => (
            <button
              key={l}
              type="button"
              role="option"
              aria-selected={l === locale}
              onClick={() => handleSelect(l)}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left transition-colors ${
                l === locale ? 'bg-brand/5 text-gray-900 font-semibold' : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="text-base leading-none">{LOCALE_META[l].flag}</span>
                <span>{LOCALE_META[l].name}</span>
              </span>
              {l === locale && (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-brand shrink-0">
                  <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
