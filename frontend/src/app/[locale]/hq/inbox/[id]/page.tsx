'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import ChatWindow from '@/components/chat/ChatWindow'
import { apiFetch } from '@/lib/api/client'
import { useAuth } from '@/lib/api/auth-context'

interface Message {
  id: string
  conversation_id: string
  sender_id: string
  sender_role: string
  content: string
  is_internal: boolean
  attachment_url: string | null
  read_at: string | null
  created_at: string
}

interface Conversation {
  id: string
  type: string
  status: string
  priority: string
  assigned_to: string | null
  created_at: string
  last_message_at: string | null
  school: string | null
  school_name: string
  school_email: string
}

const STATUS_OPTIONS = ['open', 'in_progress', 'resolved']
const PRIORITY_OPTIONS = ['low', 'medium', 'high']

// Nuovo (verde) → Aperta (azzurro) → Chiusa (grigio) — come l'inbox scuola
const STATUS_COLORS: Record<string, string> = {
  open: 'bg-green-100 text-green-700',
  in_progress: 'bg-sky-100 text-sky-700',
  resolved: 'bg-gray-100 text-gray-500',
}

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-gray-100 text-gray-500',
  medium: 'bg-orange-100 text-orange-600',
  high: 'bg-red-100 text-red-600',
}

export default function HQInboxDetailPage() {
  const t = useTranslations('hq.inbox.detail')
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const [conv, setConv] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const [convData, msgsData] = await Promise.all([
      apiFetch<Conversation>(`/chat/conversations/${id}/`).catch(() => null),
      apiFetch<Message[]>(`/chat/conversations/${id}/messages/`).catch(() => []),
    ])
    setConv(convData)
    setMessages(msgsData)
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  const updateConv = async (field: string, value: string) => {
    try {
      const updated = await apiFetch<Partial<Conversation>>(`/chat/conversations/${id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ [field]: value }),
      })
      setConv((prev) => prev ? { ...prev, ...updated } : prev)
    } catch { /* no-op */ }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
        {t('loading')}
      </div>
    )
  }

  if (!conv) {
    return (
      <div className="text-center p-8">
        <p className="text-gray-500 text-sm">{t('notFound')}</p>
        <Link href="/hq/inbox" className="text-[#6B1F3A] text-sm hover:underline mt-2 block">
          {t('backToInbox')}
        </Link>
      </div>
    )
  }

  return (
    <div className="h-[calc(100dvh-8rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Link
            href="/hq/inbox"
            className="text-sm text-gray-400 hover:text-gray-600 transition"
          >
            {t('backInbox')}
          </Link>
          <span className="text-gray-300">|</span>
          <div>
            <h1 className="text-base font-semibold text-gray-900">
              {conv.school_name || 'Unknown School'}
            </h1>
            {conv.school_email && (
              <p className="text-xs text-gray-400">{conv.school_email}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Priority */}
          <select
            value={conv.priority}
            onChange={(e) => updateConv('priority', e.target.value)}
            className={`text-xs rounded-full px-2 py-0.5 border-0 cursor-pointer font-medium ${PRIORITY_COLORS[conv.priority] ?? 'bg-gray-100 text-gray-500'}`}
          >
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {t(`priority${p === 'high' ? 'High' : p === 'low' ? 'Low' : 'Medium'}` as Parameters<typeof t>[0])}
              </option>
            ))}
          </select>

          {/* Status */}
          <select
            value={conv.status}
            onChange={(e) => updateConv('status', e.target.value)}
            className={`text-xs rounded-full px-2 py-0.5 border-0 cursor-pointer font-medium ${STATUS_COLORS[conv.status] ?? 'bg-gray-100 text-gray-500'}`}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {t(`status${s === 'in_progress' ? 'InProgress' : s === 'resolved' ? 'Resolved' : 'Open'}` as Parameters<typeof t>[0])}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Chat */}
      <div className="flex-1 bg-white rounded-xl border border-gray-100 overflow-hidden flex flex-col">
        {user && (
          <ChatWindow
            conversationId={id}
            currentUserRole="hq"
            initialMessages={messages}
          />
        )}
      </div>
    </div>
  )
}
