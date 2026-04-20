'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'

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

interface QuickReply {
  id: string
  title: string
  content: string
}

interface ChatWindowProps {
  conversationId: string
  currentUserId: string
  currentUserRole: 'hq' | 'school' | 'student'
  initialMessages?: Message[]
  quickReplies?: QuickReply[]
}

function formatTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// Note: formatDate is called before t() is available, so we pass t as parameter
function formatDate(iso: string, t: (key: string) => string) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  if (d.toDateString() === today.toDateString()) return t('dateToday')
  if (d.toDateString() === yesterday.toDateString()) return t('dateYesterday')
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function ChatWindow({
  conversationId,
  currentUserId,
  currentUserRole,
  initialMessages = [],
  quickReplies = [],
}: ChatWindowProps) {
  const t = useTranslations('common.chat')
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [input, setInput] = useState('')
  const [isInternal, setIsInternal] = useState(false)
  const [sending, setSending] = useState(false)
  const [showQuickReplies, setShowQuickReplies] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const canSendInternal = currentUserRole === 'hq' || currentUserRole === 'school'

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Supabase Realtime subscription
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`conv:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const newMsg = payload.new as Message
          // Skip internal notes for students
          if (currentUserRole === 'student' && newMsg.is_internal) return
          setMessages((prev) => {
            // Avoid duplicates (may already be added optimistically)
            if (prev.find((m) => m.id === newMsg.id)) return prev
            return [...prev, newMsg]
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [conversationId, currentUserRole])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || sending) return

    setSending(true)
    setInput('')
    setShowQuickReplies(false)

    try {
      const res = await fetch(`/api/chat/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text, is_internal: isInternal }),
      })
      if (res.ok) {
        const msg: Message = await res.json()
        setMessages((prev) => {
          if (prev.find((m) => m.id === msg.id)) return prev
          return [...prev, msg]
        })
      }
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }, [input, sending, conversationId, isInternal])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Group messages by date
  const grouped: { date: string; msgs: Message[] }[] = []
  for (const msg of messages) {
    const date = formatDate(msg.created_at, t)
    const last = grouped[grouped.length - 1]
    if (last && last.date === date) {
      last.msgs.push(msg)
    } else {
      grouped.push({ date, msgs: [msg] })
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-1">
        {grouped.length === 0 && (
          <div className="text-center text-sm text-gray-400 mt-8">
            {t('noMessages')}
          </div>
        )}
        {grouped.map((group) => (
          <div key={group.date}>
            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 h-px bg-gray-100" />
              <span className="text-xs text-gray-400">{group.date}</span>
              <div className="flex-1 h-px bg-gray-100" />
            </div>
            {group.msgs.map((msg) => {
              const isMine = msg.sender_id === currentUserId
              return (
                <div
                  key={msg.id}
                  className={`flex mb-2 ${isMine ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
                      msg.is_internal
                        ? 'bg-yellow-50 border border-yellow-200 text-yellow-900'
                        : isMine
                        ? 'bg-[#6B1F3A] text-white'
                        : 'bg-gray-100 text-gray-900'
                    }`}
                  >
                    {msg.is_internal && (
                      <span className="text-[10px] font-semibold text-yellow-600 block mb-1 uppercase tracking-wide">
                        {t('internalNote')}
                      </span>
                    )}
                    {!isMine && (
                      <span className="text-[10px] font-medium text-gray-500 block mb-1 capitalize">
                        {msg.sender_role}
                      </span>
                    )}
                    <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                    {msg.attachment_url && (
                      <a
                        href={msg.attachment_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`text-xs underline mt-1 block ${isMine ? 'text-white/80' : 'text-blue-600'}`}
                      >
                        {t('attachment')}
                      </a>
                    )}
                    <span
                      className={`text-[10px] mt-1 block ${
                        isMine && !msg.is_internal ? 'text-white/60 text-right' : 'text-gray-400'
                      }`}
                    >
                      {formatTime(msg.created_at)}
                      {isMine && msg.read_at && ` · ${t('read')}`}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Quick replies */}
      {showQuickReplies && quickReplies.length > 0 && (
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-2 flex flex-wrap gap-2">
          {quickReplies.map((qr) => (
            <button
              key={qr.id}
              onClick={() => {
                setInput(qr.content)
                setShowQuickReplies(false)
                inputRef.current?.focus()
              }}
              className="text-xs bg-white border border-gray-200 rounded-full px-3 py-1 hover:bg-gray-100 transition"
            >
              {qr.title}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="border-t border-gray-100 p-3">
        {canSendInternal && (
          <div className="flex items-center gap-2 mb-2">
            <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isInternal}
                onChange={(e) => setIsInternal(e.target.checked)}
                className="rounded"
              />
              {t('internalNoteLabel')}
            </label>
            {quickReplies.length > 0 && (
              <button
                onClick={() => setShowQuickReplies((v) => !v)}
                className="ml-auto text-xs text-[#6B1F3A] hover:underline"
              >
                {t('quickReplies')}
              </button>
            )}
          </div>
        )}
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={t('placeholder')}
            className={`flex-1 resize-none rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/30 ${
              isInternal ? 'border-yellow-300 bg-yellow-50' : 'border-gray-200 bg-white'
            }`}
            style={{ maxHeight: '120px', overflowY: 'auto' }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="bg-[#6B1F3A] text-white rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-40 hover:bg-[#5a1931] transition"
          >
            {sending ? '…' : t('send')}
          </button>
        </div>
      </div>
    </div>
  )
}
