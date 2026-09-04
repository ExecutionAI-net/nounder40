'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { Container, Kicker, PillLink } from './primitives'

export default function LandingCta() {
  const t = useTranslations('landing.cta')
  const locale = useLocale()
  const p = (path: string) => `/${locale}${path}`

  return (
    <section className="bg-bv-surface py-20 lg:py-24">
      <Container className="grid gap-5 lg:grid-cols-2">
        {/* Studentesse — pannello scuro con la foto in bianco e nero. */}
        <div className="relative overflow-hidden rounded-[2rem] bg-bv-ink p-8 text-white lg:p-10">
          <Image src="/images/hero-arms.jpg" alt="" fill sizes="(max-width: 1024px) 100vw, 50vw"
            className="object-cover object-top opacity-25" />
          <div className="relative max-w-md">
            <p className="text-[11px] font-bold uppercase leading-4 tracking-[0.12em] text-bv-blush">
              {t('studentsKicker')}
            </p>
            <h2 className="mt-3 font-display text-3xl font-semibold leading-tight lg:text-4xl">
              {t('studentsTitle')}
            </h2>
            <p className="mt-4 text-sm leading-6 text-white/75">{t('studentsBody')}</p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link href={p('/register')}
                className="inline-flex items-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-bv-primary transition-transform duration-200 hover:-translate-y-px">
                {t('studentsCta')}
              </Link>
              <span className="text-xs text-white/60">{t('studentsNote')}</span>
            </div>
          </div>
        </div>

        {/* Scuole — pannello chiaro. */}
        <div className="relative overflow-hidden rounded-[2rem] border border-bv-outline-variant/50 bg-bv-surface-container p-8 lg:p-10">
          <Image src="/images/leap.jpg" alt="" width={630} height={480}
            className="pointer-events-none absolute -bottom-6 -right-10 hidden w-64 opacity-30 md:block" />
          <div className="relative max-w-md">
            <Kicker>{t('schoolsKicker')}</Kicker>
            <h2 className="mt-3 font-display text-3xl font-semibold leading-tight text-bv-on-surface lg:text-4xl">
              {t('schoolsTitle')}
            </h2>
            <p className="mt-4 text-sm leading-6 text-bv-on-surface-variant">{t('schoolsBody')}</p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <PillLink href={p('/register')}>{t('schoolsCta')}</PillLink>
              <Link href={p('/login')}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-bv-primary-container hover:gap-2.5 transition-all">
                {t('schoolsLink')}
                <span aria-hidden>→</span>
              </Link>
            </div>
          </div>
        </div>
      </Container>
    </section>
  )
}
