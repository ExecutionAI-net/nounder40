'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { locales } from '@/i18n/routing'
import { switchLocale } from '@/lib/locale'
import { Container, PillLink } from './primitives'

/** Barra superiore + navigazione della vetrina. */
export default function LandingHeader() {
  const t = useTranslations('landing')
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const p = (path: string) => `/${locale}${path}`

  const links = [
    { href: p('/student/book'), label: t('nav.lessons') },
    { href: p('/student/book'), label: t('nav.schools') },
    { href: p('/login'), label: t('nav.metodo') },
    { href: p('/login'), label: t('nav.video') },
    { href: p('/login'), label: t('nav.teachers') },
  ]

  return (
    <header className="sticky top-0 z-50">
      {/* Ticker: le tre affermazioni che definiscono il posizionamento. */}
      <div className="bg-bv-ink text-white">
        <Container className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 py-2 text-[11px] font-bold uppercase tracking-[0.12em]">
          <span className="text-bv-blush">{t('ticker.age')}</span>
          <span className="hidden sm:inline">{t('ticker.cities')}</span>
          <span className="hidden lg:inline text-bv-gold">{t('ticker.metodo')}</span>
        </Container>
      </div>

      <div className="bv-glass border-b border-white/50">
        <Container className="flex items-center justify-between gap-4 py-3">
          <Link href={p('')} className="flex items-center gap-3">
            <Image src="/Logo.png" alt="Danza Classica No Under 40" width={120} height={42}
              priority className="h-9 w-auto object-contain" />
          </Link>

          <nav className="hidden items-center gap-6 lg:flex">
            {links.map((l, i) => (
              <Link key={i} href={l.href}
                className="text-sm font-medium text-bv-on-surface-variant transition-colors hover:text-bv-primary-container">
                {l.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-1 sm:flex">
              {/* Non un <Link>: middleware.ts riporta /it su /en finche' il
                  cookie user_locale non dice il contrario (vedi lib/locale). */}
              {locales.map(l => (
                <button key={l} type="button" onClick={() => switchLocale(l)}
                  aria-current={l === locale ? 'true' : undefined}
                  className={`rounded-full px-2 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                    l === locale
                      ? 'bg-bv-surface-container text-bv-primary-container'
                      : 'text-bv-outline hover:text-bv-primary-container'
                  }`}>
                  {l}
                </button>
              ))}
            </div>
            <PillLink href={p('/student/book')} variant="glass" className="hidden px-4 py-2 md:inline-flex">
              {t('nav.findClass')}
            </PillLink>
            <PillLink href={p('/login')} className="px-4 py-2">
              {t('nav.portal')}
            </PillLink>
            <button type="button" onClick={() => setOpen(v => !v)}
              aria-expanded={open} aria-label={t('nav.lessons')}
              className="rounded-full border border-bv-outline-variant p-2 lg:hidden">
              <span className="block h-0.5 w-4 bg-bv-on-surface" />
              <span className="mt-1 block h-0.5 w-4 bg-bv-on-surface" />
              <span className="mt-1 block h-0.5 w-4 bg-bv-on-surface" />
            </button>
          </div>
        </Container>

        {open ? (
          <Container className="flex flex-col gap-1 border-t border-bv-outline-variant/40 py-3 lg:hidden">
            {links.map((l, i) => (
              <Link key={i} href={l.href} onClick={() => setOpen(false)}
                className="rounded-xl px-3 py-2 text-sm font-medium text-bv-on-surface-variant hover:bg-bv-surface-low">
                {l.label}
              </Link>
            ))}
          </Container>
        ) : null}
      </div>
    </header>
  )
}
