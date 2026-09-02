// WebSocket client for Django Channels realtime (chat + calendar). Mirrors
// the backend's core/ws_auth.py: the JWT access token travels as ?token=
// since browsers can't set an Authorization header on the WS handshake.
'use client'

import { getAccessToken } from './api/tokens'

function wsBase(): string {
  if (typeof window === 'undefined') return ''
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}`
}

function withToken(path: string): string {
  const token = getAccessToken()
  const sep = path.includes('?') ? '&' : '?'
  return `${wsBase()}${path}${token ? `${sep}token=${encodeURIComponent(token)}` : ''}`
}

export function openSocket(path: string, handlers: { onMessage: (data: unknown) => void; onOpen?: () => void; onClose?: () => void; onError?: (ev: Event) => void }): WebSocket {
  const ws = new WebSocket(withToken(path))
  ws.onmessage = (ev) => {
    try {
      handlers.onMessage(JSON.parse(ev.data))
    } catch {
      // ignore malformed frames
    }
  }
  if (handlers.onOpen) ws.onopen = handlers.onOpen
  if (handlers.onClose) ws.onclose = handlers.onClose
  if (handlers.onError) ws.onerror = handlers.onError
  return ws
}

export function openChatSocket(conversationId: string, onMessage: (data: unknown) => void): WebSocket {
  return openSocket(`/ws/chat/${conversationId}/`, { onMessage })
}

export function openSchoolCalendarSocket(schoolId: string, onEvent: (data: unknown) => void): WebSocket {
  return openSocket(`/ws/calendar/school/${schoolId}/`, { onMessage: onEvent })
}

export function openTeacherCalendarSocket(teacherId: string, onEvent: (data: unknown) => void): WebSocket {
  return openSocket(`/ws/calendar/teacher/${teacherId}/`, { onMessage: onEvent })
}
