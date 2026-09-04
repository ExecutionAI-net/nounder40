'use client'

import Image from 'next/image'
import { useLocale, useTranslations } from 'next-intl'
import { Chip, Container, PillLink, SectionHeading } from './primitives'

export type PublicSchool = {
  id: string
  name: string
  slug: string
  city: string
  country: string
  country_code: string | null
}

type CityGroup = { city: string; countryCode: string | null; schools: PublicSchool[] }

/** Raggruppa le scuole attive per citta', le piu' fornite per prime. */
export function groupByCity(schools: PublicSchool[]): CityGroup[] {
  const map = new Map<string, CityGroup>()
  for (const school of schools) {
    const city = (school.city || '').trim()
    if (!city) continue
    const key = city.toLocaleLowerCase()
    const group = map.get(key)
    if (group) group.schools.push(school)
    else map.set(key, { city, countryCode: school.country_code, schools: [school] })
  }
  return [...map.values()].sort(
    (a, b) => b.schools.length - a.schools.length || a.city.localeCompare(b.city),
  )
}

// Le foto girano fra le card: la sezione e' guidata dai dati, quindi il numero
// di citta' non e' noto in anticipo.
const CARD_IMAGES = ['/images/barre-class.webp', '/images/class-group.webp', '/images/leap.jpg']

export default function LandingCities({ schools }: { schools: PublicSchool[] }) {
  const t = useTranslations('landing.cities')
  const locale = useLocale()
  const groups = groupByCity(schools).slice(0, 3)

  return (
    <section className="bg-bv-surface-container py-20 lg:py-24">
      <Container>
        <SectionHeading kicker={t('kicker')} title={t('title')} lead={t('lead')} align="left" />

        {groups.length > 0 ? (
          <>
            <div className="mt-8 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-bv-secondary">
                {t('activeCities')}
              </span>
              {groups.map(group => (
                <Chip key={group.city} tone="plain">
                  {group.city}
                </Chip>
              ))}
            </div>

            <div className="mt-8 grid gap-5 lg:grid-cols-3">
              {groups.map((group, i) => (
                <article key={group.city}
                  className="overflow-hidden rounded-[1.5rem] border border-white/60 bg-white bv-elevated">
                  <div className="relative h-44">
                    <Image src={CARD_IMAGES[i % CARD_IMAGES.length]} alt="" fill sizes="(max-width: 1024px) 100vw, 33vw"
                      className="object-cover" />
                    <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-bv-ink/70 to-transparent" />
                    <h3 className="absolute bottom-4 left-5 font-display text-2xl font-semibold text-white">
                      {group.city}
                    </h3>
                  </div>
                  <div className="p-5">
                    <p className="text-sm text-bv-on-surface-variant">
                      {t('studios')}: <span className="font-semibold text-bv-on-surface">{group.schools.length}</span>
                    </p>
                    <ul className="mt-3 space-y-1.5">
                      {group.schools.slice(0, 3).map(school => (
                        <li key={school.id} className="truncate text-sm text-bv-on-surface">
                          {school.name}
                        </li>
                      ))}
                    </ul>
                    <PillLink href={`/${locale}/student/book`} variant="ghost"
                      className="mt-5 w-full px-4 py-2">
                      {t('viewTimetable')}
                    </PillLink>
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : (
          <p className="mt-8 rounded-[1.5rem] border border-white/60 bg-white/70 p-6 text-sm text-bv-on-surface-variant">
            {t('empty')}
          </p>
        )}

        <div className="mt-8 flex flex-col items-start justify-between gap-4 rounded-[1.5rem] bg-white/70 p-6 sm:flex-row sm:items-center">
          <div>
            <p className="font-display text-lg font-semibold text-bv-on-surface">
              {t('horizonTitle')}
            </p>
            <p className="mt-1 text-sm text-bv-on-surface-variant">{t('horizonLead')}</p>
          </div>
          <PillLink href={`/${locale}/register`} variant="glass">
            {t('waitlist')}
          </PillLink>
        </div>
      </Container>
    </section>
  )
}
