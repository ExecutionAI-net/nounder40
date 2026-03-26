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
  assigned_to: string | null
  created_at: string
  last_message_at: string | null
  school_id: string
  schools: { id: string; name: string; email: string } | null
}

const STATUS_OPTIONS = ['open', 'in_progress', 'resolved']
const PRIORITY_OPTIONS = ['low', 'medium', 'high']

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  resolved: 'bg-green-100 text-green-700',
}

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-gray-100 text-gray-500',
  medium: 'bg-orange-100 text-orange-600',
  high: 'bg-red-100 text-red-600',
}

export default function HQInboxDetailPage() {
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

  const updateConv = async (field: string, value: string) => {
    const res = await fetch(`/api/chat/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    })
    if (res.ok) {
      const updated = await res.json()
      setConv((prev) => prev ? { ...prev, ...updated } : prev)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
        Loading…
      </div>
    )
  }

  if (!conv) {
    return (
      <div className="text-center p-8">
        <p className="text-gray-500 text-sm">Conversation not found.</p>
        <Link href="/hq/inbox" className="text-[#6B1F3A] text-sm hover:underline mt-2 block">
          ← Back to Inbox
        </Link>
      </div>
    )
  }

  const school = conv.schools

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Link
            href="/hq/inbox"
            className="text-sm text-gray-400 hover:text-gray-600 transition"
          >
            ← Inbox
          </Link>
          <span className="text-gray-300">|</span>
          <div>
            <h1 className="text-base font-semibold text-gray-900">
              {school?.name ?? 'Unknown School'}
            </h1>
            {school?.email && (
              <p className="text-xs text-gray-400">{school.email}</p>
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
              <option key={p} value={p}>{p}</option>
            ))}
          </select>

          {/* Status */}
          <select
            value={conv.status}
            onChange={(e) => updateConv('status', e.target.value)}
            className={`text-xs rounded-full px-2 py-0.5 border-0 cursor-pointer font-medium ${STATUS_COLORS[conv.status] ?? 'bg-gray-100 text-gray-500'}`}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s.replace('_', ' ')}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Chat */}
      <div className="flex-1 bg-white rounded-xl border border-gray-100 overflow-hidden flex flex-col">
        {currentUserId && (
          <ChatWindow
            conversationId={id}
            currentUserId={currentUserId}
            currentUserRole="hq"
            initialMessages={messages}
          />
        )}
      </div>
    </div>
  )
}
