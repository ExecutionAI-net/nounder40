'use client'

import { useTranslations } from 'next-intl'

export default function LocaleError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations('errorBoundary')
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center bg-gray-50">
      <h1 className="text-xl font-semibold text-gray-900">{t('title')}</h1>
      <p className="max-w-sm text-sm text-gray-600">{t('description')}</p>
      <button
        type="button"
        onClick={() => { reset(); window.location.reload() }}
        className="px-5 py-2.5 rounded-lg bg-gray-900 text-white text-sm font-medium"
      >
        {t('reload')}
      </button>
    </div>
  )
}
