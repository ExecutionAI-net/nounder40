'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from './api/client'

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
    // `scope` isn't used by the Django endpoint (visible_conversations()
    // already scopes by the caller's own role) — kept as a param for the
    // call sites, dropped here rather than forwarded.
    apiFetch<{ total: number; by_type: Record<string, number> }>('/chat/unread/')
      .then((d) => setUnread({ total: d.total ?? 0, byType: d.by_type ?? {} }))
      .catch(() => {})
  }, [])

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
