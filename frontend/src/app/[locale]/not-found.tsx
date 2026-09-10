'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/navigation'

/**
 * The 404 a visitor actually reaches: it renders inside
 * `[locale]/layout.tsx`, so `<html lang={locale}>`, the fonts and the
 * translations are already in place — no html/body of its own.
 *
 * The root `not-found.tsx` stays as the last-resort page for paths with no
 * locale to render in at all (I18N-R3-03).
 */
export default function LocaleNotFound() {
  const t = useTranslations('notFound')

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-gray-50 px-6 text-center">
      <p className="text-5xl font-bold text-brand">404</p>
      <p className="text-base text-gray-900">{t('title')}</p>
      <p className="max-w-sm text-sm text-gray-500">{t('body')}</p>
      <Link href="/" className="mt-2 text-sm font-medium text-brand hover:underline">
        ← {t('backHome')}
      </Link>
    </div>
  )
}
