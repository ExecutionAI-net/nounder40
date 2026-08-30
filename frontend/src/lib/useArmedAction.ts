import { useState } from 'react'

// Azione distruttiva a due clic: il primo arma il bottone (si disarma da
// solo), il secondo chiede conferma e poi esegue. Usato per eliminare un
// account e per annullare una lezione — mai per sbaglio.
export function useArmedAction(
  run: () => Promise<void> | void,
  { confirm, armMs = 4000 }: { confirm?: () => string; armMs?: number } = {},
) {
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)

  async function trigger() {
    if (!armed) {
      setArmed(true)
      setTimeout(() => setArmed(false), armMs)
      return
    }
    setArmed(false)
    if (confirm && !window.confirm(confirm())) return
    setBusy(true)
    try { await run() } finally { setBusy(false) }
  }

  return { armed, busy, trigger }
}
