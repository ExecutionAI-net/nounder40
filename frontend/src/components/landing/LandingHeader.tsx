'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import LanguageDropdown from '@/components/LanguageDropdown'
import { Container, PillLink } from './primitives'

/**
 * Barra superiore della vetrina, ridotta all'essenziale (20/09/2026): logo,
 * "Lezioni e orari" e "Accedi" (entrambi pulsanti `.btn-pill`), lingua. Il selettore di lingua e' lo stesso
 * LanguageDropdown dei pannelli e delle pagine auth: un solo componente
 * bandierina, un solo posto (lib/locale) dove si scrive il cookie
 * user_locale prima di navigare.
 *
 * Sotto i 390 px la navigazione va a capo sotto il logo invece di
 * nascondere una voce: sono tre elementi e devono restare tutti visibili.
 */
export default function LandingHeader() {
  const t = useTranslations('landing')
  const locale = useLocale()
  const p = (path: string) => `/${locale}${path}`

  return (
    <header className="sticky top-0 z-50">
      {/* Ticker: le tre affermazioni che definiscono il posizionamento. */}
      <div className="bg-bv-ink text-white">
        <Container className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 py-2 text-[11px] font-bold uppercase tracking-[0.12em]">
          <span>{t('ticker.age')}</span>
          <span className="hidden text-white/70 sm:inline">{t('ticker.cities')}</span>
          <span className="hidden text-white/70 lg:inline">{t('ticker.metodo')}</span>
        </Container>
      </div>

      <div className="border-b border-bv-outline-variant bg-white">
        <Container className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
          <Link href={p('')} className="flex items-center">
            <Image src="/Logo.png" alt="Danza Classica No Under 40" width={120} height={42}
              priority className="h-9 w-auto object-contain" />
          </Link>

          <nav className="ml-auto flex items-center gap-3 sm:gap-5">
            <PillLink href={p('/student/book')}>{t('nav.lessons')}</PillLink>
            <LanguageDropdown />
            <PillLink href={p('/login')}>{t('nav.login')}</PillLink>
          </nav>
        </Container>
      </div>
    </header>
  )
}
