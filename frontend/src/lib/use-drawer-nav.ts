'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { usePathname, useRouter } from '@/navigation'

// Navigazione dal drawer mobile con feedback immediato: la voce toccata
// mostra uno spinner e il menu resta aperto finché la nuova pagina non è
// pronta (in dev la prima visita compila la pagina e può volerci qualche
// secondo: senza feedback sembrava bloccato).
export function useDrawerNav(close: () => void) {
  const router = useRouter()
  const pathname = usePathname()
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const closeRef = useRef(close)
  closeRef.current = close

  // Pagina cambiata → chiudi il drawer e spegni lo spinner
  useEffect(() => {
    setPendingHref(null)
    closeRef.current()
  }, [pathname])

  function navigate(href: string) {
    if (href === pathname) {
      closeRef.current()
      return
    }
    setPendingHref(href)
    startTransition(() => router.push(href))
  }

  return { pendingHref, navigate }
}
