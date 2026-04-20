'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import ChatWindow from '@/components/chat/ChatWindow'

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
  schools: { id: string; name: string; email: string } | null
}

export default function TeacherInboxDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [conv, setConv] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [currentUserId, setCurrentUserId] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) setCurrentUserId(user.id)

    const res = await fetch(`/api/chat/conversations/${id}`)
    if (res.ok) {
      const data = await res.json()
      setConv(data.conversation)
      setMessages(data.messages)
    }
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading…</div>

  if (!conv) return (
    <div className="text-center p-8">
      <p className="text-gray-500 text-sm">Conversation not found.</p>
      <Link href="/teacher/inbox" className="text-[#6B1F3A] text-sm hover:underline mt-2 block">← Back to Inbox</Link>
    </div>
  )

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/teacher/inbox" className="text-sm text-gray-400 hover:text-gray-600 transition">← Inbox</Link>
        <span className="text-gray-300">|</span>
        <div>
          <h1 className="text-base font-semibold text-gray-900">{conv.schools?.name ?? 'School'}</h1>
          {conv.schools?.email && <p className="text-xs text-gray-400">{conv.schools.email}</p>}
        </div>
      </div>

      <div className="flex-1 bg-white rounded-xl border border-gray-100 overflow-hidden flex flex-col">
        {currentUserId && (
          <ChatWindow
            conversationId={id}
            currentUserId={currentUserId}
            currentUserRole="school"
            initialMessages={messages}
          />
        )}
      </div>
    </div>
  )
}
