'use client'

import { usePathname, useRouter } from 'next/navigation'

const LOCALES = ['en', 'it', 'es', 'fr', 'de']

// Top-left back arrow (platform-wide pattern, as in Svolgo).
// Goes to `href` when provided; otherwise to the logical parent route
// (deterministic — history.back() finiva su pagine a caso dopo tanti
// passaggi in-app, es. da /hq/shop tornava a un vecchio stato qualsiasi).
export default function BackButton({ href, label }: { href?: string; label?: string }) {
  const router = useRouter()
  const pathname = usePathname()

  function parentHref(): string {
    const parts = pathname.split('/').filter(Boolean) // es. ['it','hq','schools','123']
    const hasLocale = LOCALES.includes(parts[0])
    const prefix = hasLocale ? `/${parts[0]}` : ''
    const base = hasLocale ? parts.slice(1) : parts
    // Pagina annidata (es. /hq/schools/123) → un livello sopra (/hq/schools)
    if (base.length > 2) return `${prefix}/${base.slice(0, -1).join('/')}`
    // Pagina di primo livello (es. /hq/shop) → dashboard del ruolo
    if (base.length === 2) return `${prefix}/${base[0]}/dashboard`
    return `${prefix}/`
  }

  function goBack() {
    if (href) { router.push(href); return }
    // Vista "dettaglio" espressa in query string (es. /hq/shop?edit=<id>):
    // primo passo indietro = stessa pagina senza parametri (chiude il dettaglio)
    if (typeof window !== 'undefined' && window.location.search) {
      router.push(window.location.pathname)
      return
    }
    router.push(parentHref())
  }

  return (
    <button
      onClick={goBack}
      className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition mb-2"
      aria-label={label ?? 'Back'}
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path fillRule="evenodd" d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z" clipRule="evenodd" />
      </svg>
      {label && <span>{label}</span>}
    </button>
  )
}
