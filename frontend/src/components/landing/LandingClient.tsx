'use client'

import { useEffect, useState } from 'react'
import { useLocale } from 'next-intl'
import LandingHeader from './LandingHeader'
import LandingHero, { type UpcomingLesson } from './LandingHero'
import LandingStats, { parsePlatformStats, type PlatformStats } from './LandingStats'
import LandingRoles from './LandingRoles'
import LandingCities, { type PublicSchool } from './LandingCities'
import LandingSteps from './LandingSteps'
import LandingBoard from './LandingBoard'
import LandingCta from './LandingCta'
import LandingFooter from './LandingFooter'

// Valori mostrati finche' /platform-stats non risponde (e se HQ non li ha
// ancora impostati): la sezione non deve mai lampeggiare a zero.
const FALLBACK_STATS: PlatformStats = {
  schools: 3,
  teachers: 20,
  students: 249,
  lessonsMonthly: 950,
}

/**
 * Vetrina pubblica "Ballet Vivant".
 *
 * Client component perche' i dati arrivano da tre endpoint pubblici a runtime.
 * Non passa da lib/api/client.ts di proposito: quello aggiunge Authorization e
 * la logica di refresh, e qui non c'e' nessuna sessione da allegare.
 */
export default function LandingClient() {
  const locale = useLocale()
  const [stats, setStats] = useState<PlatformStats>(FALLBACK_STATS)
  const [schools, setSchools] = useState<PublicSchool[]>([])
  const [lessons, setLessons] = useState<UpcomingLesson[]>([])
  const [lessonsLoading, setLessonsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const json = async (url: string) => {
      try {
        const response = await fetch(url, { cache: 'no-store' })
        return response.ok ? await response.json() : null
      } catch {
        return null
      }
    }

    void (async () => {
      const [statsPayload, schoolsPayload, lessonsPayload] = await Promise.all([
        json('/api/platform-stats/'),
        json('/api/schools/public/'),
        json(`/api/lessons/public/upcoming/?days=2&limit=6&locale=${locale}`),
      ])
      if (cancelled) return

      setStats(parsePlatformStats(statsPayload, FALLBACK_STATS))
      // DRF puo' impaginare: accetta sia la lista nuda sia {results: [...]}.
      const list = (payload: unknown) =>
        Array.isArray(payload)
          ? payload
          : Array.isArray((payload as { results?: unknown[] })?.results)
            ? (payload as { results: unknown[] }).results
            : []
      setSchools(list(schoolsPayload) as PublicSchool[])
      setLessons(list(lessonsPayload) as UpcomingLesson[])
      setLessonsLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [locale])

  return (
    <div className="min-h-screen bg-bv-surface font-body text-bv-on-surface">
      <LandingHeader />
      <main>
        <LandingHero next={lessons[0]} />
        <LandingStats stats={stats} />
        <LandingRoles />
        <LandingCities schools={schools} />
        <LandingSteps />
        <LandingBoard lessons={lessons} loading={lessonsLoading} />
        <LandingCta />
      </main>
      <LandingFooter schools={schools} />
    </div>
  )
}
