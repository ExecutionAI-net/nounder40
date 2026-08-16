'use client'

import { useCallback, useEffect, useState } from 'react'

export type Unread = { total: number; byType: Record<string, number> }

const REFRESH_EVENT = 'messages-read'

/** Da chiamare dopo aver letto una conversazione, per aggiornare i badge. */
export function notifyMessagesRead() {
  window.dispatchEvent(new CustomEvent(REFRESH_EVENT))
}

/**
 * Messaggi non letti: badge nella barra laterale e sui tab della posta.
 * Si aggiorna al ritorno sulla scheda e ogni minuto, come i crediti.
 */
export function useUnreadMessages(scope?: 'school' | 'hq' | 'teacher' | 'student'): Unread {
  const [unread, setUnread] = useState<Unread>({ total: 0, byType: {} })

  const refresh = useCallback(() => {
    fetch(`/api/chat/unread${scope ? `?scope=${scope}` : ''}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setUnread({ total: d.total ?? 0, byType: d.byType ?? {} }) })
      .catch(() => {})
  }, [scope])

  useEffect(() => {
    refresh()
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener(REFRESH_EVENT, refresh)
    const interval = setInterval(refresh, 60_000)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener(REFRESH_EVENT, refresh)
      clearInterval(interval)
    }
  }, [refresh])

  return unread
}
