'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { Chip, Container, Kicker, PillLink } from './primitives'
import type { UpcomingLesson } from './LandingHero'

const hhmm = (time: string) => time.slice(0, 5)

const isToday = (isoDate: string) => {
  const now = new Date()
  const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`
  return isoDate === local
}

/**
 * Bacheca "oggi e domani alla sbarra". I dati arrivano da
 * /api/lessons/public/upcoming/: se il network non ha lezioni in programma la
 * sezione lo dice, invece di mostrare orari finti.
 */
export default function LandingBoard({
  lessons,
  loading,
}: {
  lessons: UpcomingLesson[]
  loading: boolean
}) {
  const t = useTranslations('landing.board')
  const tRoot = useTranslations('landing')
  const locale = useLocale()
  const p = (path: string) => `/${locale}${path}`

  return (
    <section className="bg-bv-surface-low py-20 lg:py-24">
      <Container>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Kicker>{t('kicker')}</Kicker>
            <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-bv-on-surface sm:text-4xl">
              {t('title')}
            </h2>
          </div>
          <Link href={p('/student/book')}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-bv-primary-container hover:gap-2.5 transition-all">
            {t('fullTimetable')}
            <span aria-hidden>→</span>
          </Link>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="space-y-3">
            {loading ? (
              <p className="rounded-[1.5rem] border border-bv-outline-variant/50 bg-white p-6 text-sm text-bv-on-surface-variant">
                {t('loading')}
              </p>
            ) : lessons.length === 0 ? (
              <p className="rounded-[1.5rem] border border-bv-outline-variant/50 bg-white p-6 text-sm text-bv-on-surface-variant">
                {t('empty')}
              </p>
            ) : (
              lessons.map(lesson => (
                <article key={lesson.id}
                  className="flex flex-wrap items-center gap-4 rounded-[1.5rem] border border-bv-outline-variant/50 bg-white p-4 sm:flex-nowrap">
                  <div className="w-20 shrink-0 text-center">
                    <p className="font-display text-xl font-bold text-bv-on-surface">
                      {hhmm(lesson.start_time)}
                    </p>
                    <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-bv-secondary">
                      {isToday(lesson.date) ? t('today') : t('tomorrow')}
                    </p>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate font-semibold text-bv-on-surface">
                        {lesson.lesson_type_name}
                      </h3>
                      {lesson.level ? <Chip tone="blush">{lesson.level}</Chip> : null}
                      {lesson.is_online ? <Chip tone="gold">{t('online')}</Chip> : null}
                    </div>
                    <p className="mt-1 truncate text-sm text-bv-on-surface-variant">
                      {[lesson.school_name, lesson.city].filter(Boolean).join(' · ')}
                      {lesson.is_full ? '' : ` · ${t('spotsLeft', { count: lesson.spots_available })}`}
                    </p>
                  </div>

                  {lesson.is_full ? (
                    <span className="rounded-full bg-bv-surface-high px-5 py-2.5 text-sm font-semibold text-bv-on-surface-variant">
                      {t('full')}
                    </span>
                  ) : (
                    <PillLink href={p('/student/book')} className="px-5 py-2.5">
                      {t('book')}
                    </PillLink>
                  )}
                </article>
              ))
            )}
          </div>

          {/* Nel design Stitch qui c'era una testimonianza inventata con una
              percentuale di sollievo dal mal di schiena. Non si pubblica una
              recensione finta ne' un'affermazione medica: al suo posto c'e' la
              fondatrice, che e' un fatto verificabile. */}
          <aside className="overflow-hidden rounded-[1.5rem] border border-bv-outline-variant/50 bg-white bv-elevated">
            <Image src="/images/founder.webp" alt="Alina Quintana" width={1200} height={1800}
              className="h-64 w-full object-cover object-top" />
            <div className="p-6">
              <Kicker>{tRoot('ticker.metodo')}</Kicker>
              <p className="mt-3 font-display text-xl font-semibold text-bv-on-surface">
                Alina Quintana
              </p>
              <p className="mt-2 text-sm leading-6 text-bv-on-surface-variant">
                {tRoot('roles.teachersBody')}
              </p>
            </div>
          </aside>
        </div>
      </Container>
    </section>
  )
}
