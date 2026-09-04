'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { Container, PillLink } from './primitives'
import { groupByCity, type PublicSchool } from './LandingCities'

export default function LandingFooter({ schools }: { schools: PublicSchool[] }) {
  const t = useTranslations('landing.footer')
  const locale = useLocale()
  const p = (path: string) => `/${locale}${path}`
  const cities = groupByCity(schools).slice(0, 5)

  const columns = [
    {
      title: t('studentsTitle'),
      links: [
        { label: t('portal'), href: p('/login') },
        { label: t('timetables'), href: p('/student/book') },
        { label: t('archive'), href: p('/login') },
        { label: t('certification'), href: p('/login') },
        { label: t('safety'), href: p('/login') },
      ],
    },
  ]

  return (
    <footer className="bg-bv-ink text-white">
      <Container className="grid gap-10 py-16 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
        <div>
          <Image src="/Logo.png" alt="Danza Classica No Under 40" width={140} height={48}
            className="h-10 w-auto object-contain brightness-0 invert" />
          <p className="mt-5 max-w-sm text-sm leading-6 text-white/65">{t('about')}</p>
          <div className="mt-6">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-bv-blush">
              {t('gazette')}
            </p>
            {/* Non esiste ancora un endpoint per la newsletter: invece di un
                campo email che non salva nulla, si porta alla registrazione. */}
            <PillLink href={p('/register')} variant="glass" className="mt-3">
              {t('subscribe')}
            </PillLink>
          </div>
        </div>

        <div>
          <p className="text-sm font-semibold">{t('citiesTitle')}</p>
          <ul className="mt-4 space-y-2.5">
            {cities.length === 0 ? (
              <li className="text-sm text-white/50">—</li>
            ) : (
              cities.map(group => (
                <li key={group.city}>
                  <Link href={p('/student/book')} className="text-sm text-white/65 hover:text-white">
                    {group.city}
                  </Link>
                </li>
              ))
            )}
          </ul>
        </div>

        {columns.map(column => (
          <div key={column.title}>
            <p className="text-sm font-semibold">{column.title}</p>
            <ul className="mt-4 space-y-2.5">
              {column.links.map(link => (
                <li key={link.label}>
                  <Link href={link.href} className="text-sm text-white/65 hover:text-white">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div>
          <p className="text-sm font-semibold">{t('houseTitle')}</p>
          <p className="mt-4 text-sm leading-6 text-white/65">{t('connect')}</p>
        </div>
      </Container>

      <div className="border-t border-white/10">
        <Container className="flex flex-col items-center justify-between gap-3 py-6 text-xs text-white/50 sm:flex-row">
          <p>
            © {new Date().getFullYear()} Danza Classica No Under 40. {t('rights')}
          </p>
          <div className="flex gap-5">
            <span>{t('privacy')}</span>
            <span>{t('terms')}</span>
            <span>{t('cookies')}</span>
          </div>
        </Container>
      </div>
    </footer>
  )
}
