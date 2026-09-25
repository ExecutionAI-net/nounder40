'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

// The human side of the short link: on to the booking page as soon as the
// script runs, a meta refresh for a browser without it, and a plain link
// as the last resort. Crawlers stop at the server HTML (the tags) and
// never get here.
export default function EventShortLinkClient({ href }: { href: string }) {
  const t = useTranslations('student.book')
  const router = useRouter()
  useEffect(() => { router.replace(href) }, [router, href])
  return (
    <>
      <noscript>
        <meta httpEquiv="refresh" content={`0;url=${href}`} />
      </noscript>
      <main className="min-h-[60vh] flex items-center justify-center p-6">
        <a href={href} className="text-sm text-gray-500 hover:text-[#6B1F3A] transition">{t('openingEvent')}</a>
      </main>
    </>
  )
}
