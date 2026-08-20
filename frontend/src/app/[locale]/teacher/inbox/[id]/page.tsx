'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
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
  created_at: string
  last_message_at: string | null
  school: string | null
  school_name: string
  school_email: string
}

export default function TeacherInboxDetailPage() {
  const t = useTranslations('teacher.inbox.detail')
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

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading…</div>

  if (!conv) return (
    <div className="text-center p-8">
      <p className="text-gray-500 text-sm">Conversation not found.</p>
      <Link href="/teacher/inbox" className="text-[#6B1F3A] text-sm hover:underline mt-2 block">{t('buttonBack')}</Link>
    </div>
  )

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/teacher/inbox" className="text-sm text-gray-400 hover:text-gray-600 transition">{t('buttonBack')}</Link>
        <span className="text-gray-300">|</span>
        <div>
          <h1 className="text-base font-semibold text-gray-900">{conv.school_name || 'School'}</h1>
          {conv.school_email && <p className="text-xs text-gray-400">{conv.school_email}</p>}
        </div>
      </div>

      <div className="flex-1 bg-white rounded-xl border border-gray-100 overflow-hidden flex flex-col">
        {user && (
          <ChatWindow
            conversationId={id}
            currentUserRole="teacher"
            initialMessages={messages}
          />
        )}
      </div>
    </div>
  )
}
