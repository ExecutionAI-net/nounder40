'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import { Chip, Container } from './primitives'

export type PlatformStats = {
  schools: number
  teachers: number
  students: number
  lessonsMonthly: number
}

/**
 * /api/platform-stats/ e' un dump grezzo di platform_settings: chiavi
 * `stat_*` con valori stringa. La vecchia landing faceva `setStats(payload)`
 * aspettandosi {teachers, students, ...}, quindi in produzione i contatori
 * diventavano undefined. Qui la mappatura e' esplicita.
 */
export function parsePlatformStats(payload: unknown, fallback: PlatformStats): PlatformStats {
  if (!payload || typeof payload !== 'object') return fallback
  const raw = payload as Record<string, unknown>
  const num = (key: string, dflt: number) => {
    const parsed = Number(raw[key])
    return Number.isFinite(parsed) && parsed > 0 ? parsed : dflt
  }
  return {
    schools: num('stat_schools', fallback.schools),
    teachers: num('stat_teachers', fallback.teachers),
    students: num('stat_students', fallback.students),
    lessonsMonthly: num('stat_lessons_monthly', fallback.lessonsMonthly),
  }
}

/**
 * Il conteggio animato e' una rifinitura, mai la fonte del numero: se
 * requestAnimationFrame non gira — scheda in background, tab occlusa,
 * prefers-reduced-motion — il visitatore deve comunque leggere il totale, non
 * uno zero. Per questo un timer di sicurezza fissa il valore finale a
 * prescindere dai frame, e chi ha chiesto meno animazioni lo vede subito.
 */
function useCountUp(target: number, active: boolean, duration = 1600) {
  const safe = Number.isFinite(target) && target > 0 ? Math.round(target) : 0
  const [value, setValue] = useState(safe)

  useEffect(() => {
    if (!active || safe === 0) {
      setValue(safe)
      return
    }
    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setValue(safe)
      return
    }

    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration)
      // Ease-out: il numero rallenta arrivando al valore finale.
      setValue(Math.round(safe * (1 - Math.pow(1 - progress, 3))))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    setValue(0)
    frame = requestAnimationFrame(tick)
    const settle = setTimeout(() => setValue(safe), duration + 150)

    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(settle)
    }
  }, [safe, active, duration])

  return value
}

function StatCard({
  tag,
  value,
  label,
  note,
  active,
}: {
  tag: string
  value: number
  label: string
  note: string
  active: boolean
}) {
  const shown = useCountUp(value, active)
  return (
    <div className="rounded-[1.5rem] border border-bv-outline-variant/50 bg-white p-6 bv-elevated">
      <Chip tone="plain">{tag}</Chip>
      <p className="mt-4 font-display text-4xl font-bold text-bv-on-surface">
        {shown.toLocaleString()}
        <span className="text-bv-blush">+</span>
      </p>
      <p className="mt-1 text-base font-semibold text-bv-on-surface">{label}</p>
      <p className="mt-1 text-sm leading-5 text-bv-on-surface-variant">{note}</p>
    </div>
  )
}

export default function LandingStats({ stats }: { stats: PlatformStats }) {
  const t = useTranslations('landing.stats')
  const ref = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setActive(true),
      { threshold: 0.25 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const cards = [
    { tag: t('verified'), value: stats.schools, label: t('studios'), note: t('studiosNote') },
    { tag: t('pedagogy'), value: stats.teachers, label: t('teachers'), note: t('teachersNote') },
    { tag: t('growing'), value: stats.students, label: t('students'), note: t('studentsNote') },
    { tag: t('realtime'), value: stats.lessonsMonthly, label: t('lessons'), note: t('lessonsNote') },
  ]

  return (
    <section className="bg-bv-surface-low py-14">
      <Container>
        <div ref={ref} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map(card => (
            <StatCard key={card.label} {...card} active={active} />
          ))}
        </div>
      </Container>
    </section>
  )
}
