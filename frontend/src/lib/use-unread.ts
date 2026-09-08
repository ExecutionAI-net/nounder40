'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from './api/client'
import { openInboxSocket } from './ws'

export type Unread = { total: number; byType: Record<string, number> }

const REFRESH_EVENT = 'messages-read'
/** Dispatched on `window` for every inbox signal (new message / read elsewhere),
 * so an open inbox page can refresh its list too. `detail` is the raw event. */
export const INBOX_EVENT = 'inbox-changed'

const RECONNECT_MIN_MS = 3_000
const RECONNECT_MAX_MS = 60_000

/** Da chiamare dopo aver letto una conversazione, per aggiornare i badge. */
export function notifyMessagesRead() {
  window.dispatchEvent(new CustomEvent(REFRESH_EVENT))
}

/**
 * Messaggi non letti: badge nella barra laterale e sui tab della posta.
 * In tempo reale tramite il socket `/ws/inbox/` (un ping per ogni messaggio
 * nuovo o letto altrove); il polling ogni minuto e al ritorno sulla scheda
 * resta come rete di sicurezza se il socket cade.
 */
export function useUnreadMessages(scope?: 'school' | 'hq' | 'teacher' | 'student', enabled = true): Unread {
  const [unread, setUnread] = useState<Unread>({ total: 0, byType: {} })

  const refresh = useCallback(() => {
    if (!enabled) return
    // `scope` isn't used by the Django endpoint (visible_conversations()
    // already scopes by the caller's own role) — kept as a param for the
    // call sites, dropped here rather than forwarded.
    apiFetch<{ total: number; by_type: Record<string, number> }>('/chat/unread/')
      .then((d) => setUnread({ total: d.total ?? 0, byType: d.by_type ?? {} }))
      .catch(() => {})
  }, [enabled])

  useEffect(() => {
    // QA ST-R2-17: the student panel is the only one that lets an anonymous
    // visitor browse at all (see StudentLayout's comment) -- every other
    // panel sits behind useRequireRole(), so `enabled` only ever turns this
    // off there. Without it, an anonymous student page always fired
    // /chat/unread/ on mount and logged a 401 that nothing surfaced.
    if (!enabled) return
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
  }, [refresh, enabled])

  useEffect(() => {
    if (!enabled) return
    let ws: WebSocket | null = null
    let stopped = false
    let retryMs = RECONNECT_MIN_MS
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      if (stopped) return
      ws = openInboxSocket({
        onEvent: (data) => {
          refresh()
          window.dispatchEvent(new CustomEvent(INBOX_EVENT, { detail: data }))
        },
        onClose: () => {
          ws = null
          if (stopped) return
          // A 4401 (expired access token) recovers on its own: the next
          // attempt reads the token apiFetch will have refreshed meanwhile.
          retryTimer = setTimeout(() => {
            retryMs = Math.min(retryMs * 2, RECONNECT_MAX_MS)
            connect()
          }, retryMs)
        },
      })
      ws.onopen = () => { retryMs = RECONNECT_MIN_MS }
    }

    // Don't wait out a long backoff when the user comes back to the tab.
    const onVisibility = () => {
      if (document.visibilityState !== 'visible' || ws || stopped) return
      if (retryTimer) clearTimeout(retryTimer)
      retryMs = RECONNECT_MIN_MS
      connect()
    }

    connect()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVisibility)
      if (retryTimer) clearTimeout(retryTimer)
      ws?.close()
    }
  }, [refresh, enabled])

  return unread
}
