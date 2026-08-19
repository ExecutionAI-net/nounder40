'use client'

import { useEffect } from 'react'

// Pulizia una tantum per i browser rimasti agganciati a un service worker o a
// una Cache Storage di una versione precedente dell'app: succedeva di vedere
// l'interfaccia vecchia in navigazione normale e quella nuova in incognito.
//
// Gira una volta sola per browser (flag in localStorage): un service worker
// aggiunto in futuro per la PWA non viene toccato. Per rifarla girare dopo un
// altro incidente di cache basta alzare la versione della chiave.
const RESET_KEY = 'nu40-cache-reset-v1'

export default function CacheReset() {
  useEffect(() => {
    let alreadyDone = true
    try {
      alreadyDone = !!localStorage.getItem(RESET_KEY)
      if (!alreadyDone) localStorage.setItem(RESET_KEY, '1')
    } catch {
      return // storage non disponibile: meglio non fare nulla
    }
    if (alreadyDone) return

    async function cleanup() {
      let removedSomething = false

      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations().catch(() => [])
        for (const reg of regs) {
          await reg.unregister().catch(() => {})
          removedSomething = true
        }
      }

      if ('caches' in window) {
        const keys = await caches.keys().catch(() => [])
        for (const key of keys) {
          await caches.delete(key).catch(() => {})
          removedSomething = true
        }
      }

      // Solo se c'era davvero della roba vecchia: ricarico per prendere gli
      // asset aggiornati. Il flag è già scritto, quindi niente ciclo di reload.
      if (removedSomething) window.location.reload()
    }

    cleanup()
  }, [])

  return null
}
