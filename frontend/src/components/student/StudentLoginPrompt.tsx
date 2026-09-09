'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/navigation'

/**
 * "Accedi per continuare" — la scheda che le pagine dello studente legate
 * all'account mostrano a un visitatore anonimo.
 *
 * Il pannello studente e' l'unico che un anonimo puo' sfogliare
 * (StudentLayout non ha useRequireRole(): calendario e cataloghi restano
 * pubblici), quindi ogni pagina deve decidere da sola cosa fare senza
 * sessione. ST-R2-17 lo aveva sistemato per pacchetti/acquisti/negozio,
 * PR #115 per dashboard e prenotazioni — ognuna con la propria copia della
 * stessa scheda. ST-R3-05 ha trovato le due rimaste (profilo: scheletro che
 * non finisce mai; assistenza: "Caricamento" per sempre), e una quarta e
 * quinta copia non erano la risposta.
 *
 * Il testo resta della pagina (`loginPromptTitle`/`loginPromptText` nel suo
 * namespace): quello che si perde restando fuori e' diverso ogni volta.
 */
export default function StudentLoginPrompt({
  title,
  text,
  next,
  icon,
}: {
  title: string
  text: string
  /** Dove tornare dopo l'accesso, es. "/student/profile". */
  next: string
  icon?: ReactNode
}) {
  const tLayout = useTranslations('layout')
  const target = encodeURIComponent(next)

  return (
    <div className="max-w-md mx-auto mt-10 bg-white rounded-2xl border border-gray-100 p-8 text-center">
      <div className="w-12 h-12 mx-auto rounded-full bg-brand/10 text-brand flex items-center justify-center mb-3">
        {icon ?? (
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
          </svg>
        )}
      </div>
      <h2 className="font-semibold text-gray-900 text-lg">{title}</h2>
      <p className="text-sm text-gray-500 mt-1.5 mb-6">{text}</p>
      <div className="space-y-2">
        <Link href={`/register?next=${target}`}
          className="block w-full py-2.5 bg-brand text-white rounded-xl text-sm font-medium hover:bg-brand-hover transition">
          {tLayout('register')}
        </Link>
        <Link href={`/login?next=${target}`}
          className="block w-full py-2.5 border border-brand/30 text-brand rounded-xl text-sm font-medium hover:bg-brand/5 transition">
          {tLayout('signIn')}
        </Link>
      </div>
    </div>
  )
}
