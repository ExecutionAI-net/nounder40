'use client'

import Image from 'next/image'
import { useLocale, useTranslations } from 'next-intl'
import { Chip, Container, PillLink } from './primitives'

export type UpcomingLesson = {
  id: string
  date: string
  start_time: string
  end_time: string
  is_online: boolean
  lesson_type_name: string
  level: string
  school_name: string
  school_slug: string
  city: string
  spots_available: number
  is_full: boolean
}

const hhmm = (t: string) => t.slice(0, 5)

/**
 * Hero: titolo editoriale a sinistra, collage fotografico a destra.
 * Il badge "prossima alla sbarra" mostra la prima lezione reale del network
 * (endpoint pubblico), non un orario inventato: se non c'e' nulla in
 * programma il badge sparisce invece di mentire.
 */
export default function LandingHero({ next }: { next?: UpcomingLesson }) {
  const t = useTranslations('landing')
  const locale = useLocale()
  const p = (path: string) => `/${locale}${path}`

  return (
    <section className="relative overflow-hidden bg-bv-surface">
      <div aria-hidden
        className="pointer-events-none absolute -right-32 -top-32 h-[420px] w-[420px] rounded-full bg-bv-surface-container blur-3xl" />
      <Container className="relative grid items-center gap-12 py-16 lg:grid-cols-2 lg:py-24">
        <div>
          <Chip>{t('ticker.metodo')}</Chip>
          <h1 className="mt-5 font-display text-[40px] font-bold leading-[46px] tracking-tight text-bv-on-surface lg:text-[64px] lg:leading-[72px]">
            {t('hero.title1')}
            <br />
            <span className="text-bv-primary-container">{t('hero.title2')}</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-7 text-bv-on-surface-variant">
            {t('hero.lead')}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <PillLink href={p('/register')}>{t('hero.ctaPrimary')}</PillLink>
            <PillLink href={p('/student/book')} variant="ghost">
              {t('hero.ctaSecondary')}
            </PillLink>
          </div>
          <p className="mt-6 text-sm text-bv-on-surface-variant">{t('hero.ratingNote')}</p>
        </div>

        <div className="relative">
          <div className="overflow-hidden rounded-[2rem] bv-elevated">
            <Image src="/images/barre-pink.webp" alt="" width={1200} height={1800} priority
              className="h-[420px] w-full object-cover lg:h-[520px]" />
          </div>

          {/* Riquadro sfalsato: il collage asimmetrico del DESIGN.md. */}
          <div className="absolute -bottom-8 -left-4 hidden w-52 overflow-hidden rounded-[1.5rem] border-4 border-bv-surface bv-elevated sm:block">
            <Image src="/images/class-group.webp" alt="" width={800} height={1200}
              className="h-40 w-full object-cover" />
          </div>

          <div className="absolute -right-2 top-6 bv-glass rounded-full px-4 py-2 text-xs font-semibold text-bv-primary">
            {t('hero.badgeVibe')}: {t('hero.badgeVibeValue')}
          </div>

          {next ? (
            <div className="absolute bottom-6 right-4 max-w-[15rem] rounded-2xl bg-bv-ink/85 px-4 py-3 text-white backdrop-blur">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-bv-blush">
                {t('hero.badgeNext')}
              </p>
              <p className="mt-1 truncate text-sm font-semibold">{next.lesson_type_name}</p>
              <p className="text-xs text-white/70">
                {hhmm(next.start_time)} · {next.school_name}
              </p>
            </div>
          ) : null}
        </div>
      </Container>
    </section>
  )
}
