'use client'

/**
 * Pezzi condivisi della landing "Ballet Vivant". I colori arrivano dai token
 * `bv-*` in globals.css: qui non si scrivono mai esadecimali a mano.
 */
import Link from 'next/link'
import type { ReactNode } from 'react'

/** Etichetta maiuscola sopra i titoli di sezione (DESIGN.md, "label-caps"). */
export function Kicker({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-bold uppercase leading-4 tracking-[0.12em] text-bv-secondary">
      {children}
    </p>
  )
}

export function SectionHeading({
  kicker,
  title,
  lead,
  align = 'center',
}: {
  kicker: string
  title: string
  lead?: string
  align?: 'center' | 'left'
}) {
  const centered = align === 'center'
  return (
    <div className={centered ? 'mx-auto max-w-3xl text-center' : 'max-w-3xl'}>
      <Kicker>{kicker}</Kicker>
      <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-bv-on-surface sm:text-4xl lg:text-[44px] lg:leading-[52px]">
        {title}
      </h2>
      {lead ? (
        <p className="mt-4 text-base leading-7 text-bv-on-surface-variant sm:text-lg">{lead}</p>
      ) : null}
    </div>
  )
}

/** Pillola piena bordeaux — l'azione principale (DESIGN.md, "Primary Action"). */
export function PillLink({
  href,
  children,
  variant = 'primary',
  className = '',
}: {
  href: string
  children: ReactNode
  variant?: 'primary' | 'glass' | 'ghost'
  className?: string
}) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-transform duration-200 hover:-translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bv-primary-container'
  const styles = {
    primary: 'bg-bv-primary-container text-white hover:bv-glow',
    glass: 'bv-glass text-bv-primary border-bv-blush/60',
    ghost: 'border border-bv-outline-variant text-bv-on-surface hover:bg-bv-surface-low',
  }[variant]
  return (
    <Link href={href} className={`${base} ${styles} ${className}`}>
      {children}
    </Link>
  )
}

/** Tag pillola a bassa opacità per stati e categorie. */
export function Chip({
  children,
  tone = 'blush',
}: {
  children: ReactNode
  tone?: 'blush' | 'gold' | 'plain'
}) {
  const styles = {
    blush: 'border-bv-blush/50 bg-bv-surface-container text-bv-secondary',
    gold: 'border-bv-gold/50 bg-bv-gold/10 text-[#6b5600]',
    plain: 'border-bv-outline-variant bg-white/70 text-bv-on-surface-variant',
  }[tone]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold uppercase leading-4 tracking-[0.12em] ${styles}`}
    >
      {children}
    </span>
  )
}

/** Contenitore a larghezza massima del design system (container-max: 1280px). */
export function Container({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`mx-auto w-full max-w-[1280px] px-4 lg:px-6 ${className}`}>{children}</div>
}
