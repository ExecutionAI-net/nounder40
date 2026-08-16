'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { notifyMessagesRead } from '@/lib/use-unread'

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
  /** Non usato per l'allineamento (vedi sender_role), utile per estensioni future */
  currentUserId: string
  currentUserRole: 'hq' | 'school' | 'student' | 'teacher'
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
  const [attachment, setAttachment] = useState<{ path: string; name: string; mime: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [attachError, setAttachError] = useState<string | null>(null)
  // Eliminazione a due clic: il primo arma, il secondo cancella
  const [armedDelete, setArmedDelete] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const canSendInternal = currentUserRole === 'hq' || currentUserRole === 'school'

  // I messaggi possono arrivare dopo il primo render (la pagina apre la chat
  // e poi li carica): senza questo la finestra restava vuota per sempre,
  // perché lo stato veniva inizializzato una volta sola.
  useEffect(() => {
    setMessages(initialMessages)
  }, [conversationId, initialMessages])

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Chat aperta = messaggi letti: azzera il badge nella barra laterale
  useEffect(() => {
    fetch(`/api/chat/conversations/${conversationId}/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: currentUserRole }),
    })
      .then(() => notifyMessagesRead())
      .catch(() => {})
  }, [conversationId, currentUserRole, messages.length])

  // Supabase Realtime subscription
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`conv:${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'messages' },
        (payload) => {
          const removed = (payload.old as { id?: string })?.id
          if (removed) setMessages(prev => prev.filter(m => m.id !== removed))
        }
      )
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
    if ((!text && !attachment) || sending) return

    setSending(true)
    setInput('')
    setShowQuickReplies(false)
    const sentAttachment = attachment
    setAttachment(null)

    try {
      const res = await fetch(`/api/chat/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: text,
          is_internal: isInternal,
          attachment_url: sentAttachment?.path ?? null,
          role: currentUserRole,
        }),
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
  }, [input, sending, conversationId, isInternal, attachment, currentUserRole])

  // Immagini, PDF e documenti: caricati subito, allegati al messaggio dopo
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setAttachError(null)

    const body = new FormData()
    body.append('file', file)
    const res = await fetch(`/api/chat/conversations/${conversationId}/attachment`, { method: 'POST', body })
    const data = await res.json().catch(() => ({}))

    if (res.ok) setAttachment(data)
    else setAttachError(data.error === 'too_large' ? t('attachTooLarge') : data.error === 'invalid_type' ? t('attachInvalidType') : t('attachFailed'))

    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleDelete(messageId: string) {
    if (armedDelete !== messageId) {
      setArmedDelete(messageId)
      setTimeout(() => setArmedDelete(current => (current === messageId ? null : current)), 4000)
      return
    }
    setArmedDelete(null)
    setMessages(prev => prev.filter(m => m.id !== messageId))
    await fetch(`/api/chat/messages/${messageId}?role=${currentUserRole}`, { method: 'DELETE' })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Si elimina ciò che ha scritto la propria parte; scuola e HQ possono
  // ripulire anche il resto della conversazione che gestiscono.
  const canDelete = (msg: Message) =>
    msg.sender_role === currentUserRole || currentUserRole === 'school' || currentUserRole === 'hq'

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
              const isMine = msg.sender_role === currentUserRole
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
                      <span className="text-[10px] font-medium text-gray-500 block mb-1">
                        {t(`role.${msg.sender_role}` as Parameters<typeof t>[0])}
                      </span>
                    )}
                    <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                    {msg.attachment_url && (() => {
                      // I messaggi vecchi hanno un URL intero, i nuovi il
                      // percorso nel bucket privato (link firmato al volo)
                      const isLegacyUrl = /^https?:\/\//i.test(msg.attachment_url)
                      const href = isLegacyUrl
                        ? msg.attachment_url
                        : `/api/chat/conversations/${conversationId}/attachment?path=${encodeURIComponent(msg.attachment_url)}`
                      const fileName = decodeURIComponent(msg.attachment_url.split('/').pop() ?? '').replace(/^\d+-/, '')
                      const isImage = /\.(jpe?g|png|webp|gif)$/i.test(fileName)

                      return isImage ? (
                        <a href={href} target="_blank" rel="noopener noreferrer" className="block mt-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={href} alt={fileName} className="rounded-lg max-h-56 w-auto object-cover" />
                        </a>
                      ) : (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`flex items-center gap-2 mt-2 rounded-lg px-2.5 py-2 text-xs ${
                            isMine ? 'bg-white/15 text-white' : 'bg-white text-gray-700 border border-gray-200'
                          }`}
                        >
                          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                          </svg>
                          <span className="truncate max-w-44">{fileName || t('attachment')}</span>
                        </a>
                      )
                    })()}
                    <span
                      className={`text-[10px] mt-1 flex items-center gap-2 ${
                        isMine && !msg.is_internal ? 'text-white/60 justify-end' : 'text-gray-400'
                      }`}
                    >
                      {formatTime(msg.created_at)}
                      {isMine && msg.read_at && ` · ${t('read')}`}
                      {canDelete(msg) && (
                        <button
                          onClick={() => handleDelete(msg.id)}
                          className={`underline underline-offset-2 transition ${
                            armedDelete === msg.id
                              ? 'text-red-300 font-semibold'
                              : isMine && !msg.is_internal ? 'text-white/50 hover:text-white' : 'text-gray-300 hover:text-red-500'
                          }`}
                        >
                          {armedDelete === msg.id ? t('deleteConfirm') : t('delete')}
                        </button>
                      )}
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
        {/* Allegato in attesa di invio */}
        {(attachment || attachError) && (
          <div className="mb-2">
            {attachError && <p className="text-xs text-red-600">{attachError}</p>}
            {attachment && (
              <div className="inline-flex items-center gap-2 bg-gray-100 rounded-lg px-2.5 py-1.5">
                <span className="text-xs text-gray-700 truncate max-w-52">{attachment.name}</span>
                <button onClick={() => setAttachment(null)} className="text-gray-400 hover:text-gray-700 text-xs">✕</button>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,.doc,.docx,.xls,.xlsx,.txt"
            onChange={handleFile}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            title={t('attach')}
            className="shrink-0 w-10 h-10 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-800 transition disabled:opacity-50 flex items-center justify-center"
          >
            {uploading ? '…' : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
              </svg>
            )}
          </button>
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
            disabled={(!input.trim() && !attachment) || sending}
            className="bg-[#6B1F3A] text-white rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-40 hover:bg-[#5a1931] transition"
          >
            {sending ? '…' : t('send')}
          </button>
        </div>
      </div>
    </div>
  )
}
