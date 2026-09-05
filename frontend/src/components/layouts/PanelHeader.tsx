'use client'

import { useTranslations } from 'next-intl'
import LanguageDropdown from '@/components/LanguageDropdown'

// Slim desktop top bar for HQ/School/Teacher — these panels otherwise have no
// header, only the sidebar. Search and the notification bell are visual only
// for now (no backend behind them yet); the language selector is the one
// piece that actually does something.
export default function PanelHeader() {
  const t = useTranslations('header')

  return (
    <div className="hidden md:flex sticky top-0 z-20 items-center justify-end gap-3 h-16 px-8 bg-white border-b border-gray-200 shrink-0">
      <div className="relative hidden lg:block">
        <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-gray-400">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
        </span>
        <input
          type="text"
          placeholder={t('searchPlaceholder')}
          className="w-56 text-xs bg-gray-50 text-gray-700 pl-9 pr-3 py-1.5 rounded-full border border-gray-200 focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand transition-all placeholder:text-gray-400"
        />
      </div>
      <button
        type="button"
        aria-label={t('notifications')}
        className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
        </svg>
      </button>
      <div className="h-5 w-px bg-gray-200" />
      <LanguageDropdown variant="light" />
    </div>
  )
}
