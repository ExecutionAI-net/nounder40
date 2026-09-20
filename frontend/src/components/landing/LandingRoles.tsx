'use client'

import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { Chip, Container, FORMAZIONE_URL, SectionHeading, isExternal } from './primitives'

type Role = {
  tag: string
  title: string
  body: string
  points: string[]
  /** Nessun rimando per le maestre: l'accesso passa dall'invito della scuola. */
  cta?: { label: string; href: string }
}

/**
 * Le quattro aree della piattaforma, una per ruolo. Le allieve vanno alla
 * registrazione; scuole e direzione della rete alla pagina Formazione su
 * alinaquintana.com (link fisso, come nel riquadro "Espandi la tua rete").
 */
export default function LandingRoles() {
  const t = useTranslations('landing.roles')
  const locale = useLocale()
  const p = (path: string) => `/${locale}${path}`

  const roles: Role[] = [
    {
      tag: t('dancersTag'), title: t('dancersTitle'), body: t('dancersBody'),
      points: [t('dancers1'), t('dancers2'), t('dancers3')],
      cta: { label: t('dancersCta'), href: p('/register') },
    },
    {
      tag: t('teachersTag'), title: t('teachersTitle'), body: t('teachersBody'),
      points: [t('teachers1'), t('teachers2'), t('teachers3')],
    },
    {
      tag: t('studiosTag'), title: t('studiosTitle'), body: t('studiosBody'),
      points: [t('studios1'), t('studios2'), t('studios3')],
      cta: { label: t('studiosCta'), href: FORMAZIONE_URL },
    },
    {
      tag: t('hqTag'), title: t('hqTitle'), body: t('hqBody'),
      points: [t('hq1'), t('hq2'), t('hq3')],
      cta: { label: t('hqCta'), href: FORMAZIONE_URL },
    },
  ]

  const ctaCls = 'mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-bv-on-surface transition-all hover:gap-2.5'

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
              {role.cta ? (
                isExternal(role.cta.href) ? (
                  <a href={role.cta.href} target="_blank" rel="noopener noreferrer" className={ctaCls}>
                    {role.cta.label}
                    <span aria-hidden>→</span>
                  </a>
                ) : (
                  <Link href={role.cta.href} className={ctaCls}>
                    {role.cta.label}
                    <span aria-hidden>→</span>
                  </Link>
                )
              ) : null}
            </div>
          ))}
        </div>
      </Container>
    </section>
  )
}
