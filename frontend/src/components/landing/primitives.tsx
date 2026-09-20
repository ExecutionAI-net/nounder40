'use client'

/**
 * Pezzi condivisi della landing. I colori arrivano dai token `bv-*` in
 * globals.css (dal 20/09/2026 la palette del pannello studente: bianco e
 * grigio #3D3D3D): qui non si scrivono mai esadecimali a mano.
 */
import Link from 'next/link'
import type { ReactNode } from 'react'

/** Etichetta maiuscola sopra i titoli di sezione. */
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

/** Formazione e accreditamento Metodo vivono sul sito di Alina Quintana. */
export const FORMAZIONE_URL = 'https://alinaquintana.com/formazione/'

export const isExternal = (href: string) => /^https?:\/\//i.test(href)

/**
 * Pillola del sito vetrina (`.btn-pill` in globals.css): fondo bianco,
 * cornice, etichetta maiuscola sottolineata — lo stesso pulsante del
 * pannello studente e del negozio. Un solo aspetto per tutte le azioni della
 * landing; `arrow` aggiunge la freccia finale, che resta fuori dalla
 * sottolineatura. Gli URL assoluti (sito alinaquintana.com) aprono in una
 * nuova scheda.
 */
export function PillLink({
  href,
  children,
  arrow = false,
  className = '',
}: {
  href: string
  children: ReactNode
  arrow?: boolean
  className?: string
}) {
  const cls = `btn-pill ${className}`
  const body = (
    <>
      <span>{children}</span>
      {arrow ? <span aria-hidden>→</span> : null}
    </>
  )
  if (isExternal(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {body}
      </a>
    )
  }
  return (
    <Link href={href} className={cls}>
      {body}
    </Link>
  )
}

/** Tag pillola per stati e categorie: grigio chiaro su fondo chiaro. */
export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-bv-outline-variant bg-bv-surface-low px-3 py-1 text-[11px] font-bold uppercase leading-4 tracking-[0.12em] text-bv-on-surface-variant">
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
