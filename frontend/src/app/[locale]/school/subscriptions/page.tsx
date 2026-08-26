'use client'

import { useEffect } from 'react'
import { useRouter } from '@/navigation'

// Un solo motore pacchetti/crediti: gli "abbonamenti" sono pacchetti
// ricorrenti gestiti dalla pagina Pacchetti (PACKAGE_TO_SUBSCRIPTION.md).
// Questa rotta resta solo per i vecchi segnalibri e rimanda lì.
export default function SchoolSubscriptionsPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/school/packages')
  }, [router])
  return null
}
