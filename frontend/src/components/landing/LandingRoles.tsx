'use client'

import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { Chip, Container, SectionHeading } from './primitives'

/** I quattro portali della piattaforma, uno per ruolo. */
export default function LandingRoles() {
  const t = useTranslations('landing.roles')
  const locale = useLocale()
  const p = (path: string) => `/${locale}${path}`

  const roles = [
    {
      tag: t('dancersTag'), title: t('dancersTitle'), body: t('dancersBody'),
      points: [t('dancers1'), t('dancers2'), t('dancers3')],
      cta: t('dancersCta'), href: p('/register'),
    },
    {
      tag: t('teachersTag'), title: t('teachersTitle'), body: t('teachersBody'),
      points: [t('teachers1'), t('teachers2'), t('teachers3')],
      cta: t('teachersCta'), href: p('/login'),
    },
    {
      tag: t('studiosTag'), title: t('studiosTitle'), body: t('studiosBody'),
      points: [t('studios1'), t('studios2'), t('studios3')],
      cta: t('studiosCta'), href: p('/login'),
    },
    {
      tag: t('hqTag'), title: t('hqTitle'), body: t('hqBody'),
      points: [t('hq1'), t('hq2'), t('hq3')],
      cta: t('hqCta'), href: p('/login'),
    },
  ]

  return (
    <section className="bg-bv-surface py-20 lg:py-24">
      <Container>
        <SectionHeading kicker={t('kicker')} title={t('title')} lead={t('lead')} />
        <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {roles.map(role => (
            <div key={role.title}
              className="flex flex-col rounded-[1.5rem] border border-bv-outline-variant/50 bg-white p-6 transition-transform duration-200 hover:-translate-y-1 bv-elevated">
              <Chip>{role.tag}</Chip>
              <h3 className="mt-4 font-display text-2xl font-semibold text-bv-on-surface">
                {role.title}
              </h3>
              <p className="mt-3 text-sm leading-6 text-bv-on-surface-variant">{role.body}</p>
              <ul className="mt-5 flex-1 space-y-2.5">
                {role.points.map(point => (
                  <li key={point} className="flex gap-2 text-sm text-bv-on-surface">
                    <span aria-hidden
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-bv-blush" />
                    {point}
                  </li>
                ))}
              </ul>
              <Link href={role.href}
                className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-bv-primary-container hover:gap-2.5 transition-all">
                {role.cta}
                <span aria-hidden>→</span>
              </Link>
            </div>
          ))}
        </div>
      </Container>
    </section>
  )
}
