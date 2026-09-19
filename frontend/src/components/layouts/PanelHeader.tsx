'use client'

import LanguageDropdown from '@/components/LanguageDropdown'

// Slim desktop top bar for HQ/School/Teacher — these panels otherwise have no
// header, only the sidebar. Only the language selector: the search box and
// the notification bell that used to sit here had nothing behind them and
// made the app look broken (Carlo, 2026-09-19).
export default function PanelHeader() {
  return (
    <div className="hidden md:flex sticky top-0 z-20 items-center justify-end gap-3 h-16 px-8 bg-white border-b border-gray-200 shrink-0">
      <LanguageDropdown variant="light" />
    </div>
  )
}
