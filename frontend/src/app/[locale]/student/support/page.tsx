'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/lib/api/auth-context'
import { apiFetch } from '@/lib/api/client'
import ChatWindow from '@/components/chat/ChatWindow'
import { useTranslations } from 'next-intl'

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
  status: string
  created_at: string
  last_message_at: string | null
}

const STATUS_COLORS: Record<string, string> = {
  open: 'text-blue-600',
  in_progress: 'text-yellow-600',
  resolved: 'text-green-600',
}

function timeAgo(iso: string | null, t: (key: string, params?: Record<string, string | number>) => string): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return t('justNow')
  if (mins < 60) return t('minutesAgo', { count: mins })
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return t('hoursAgo', { count: hrs })
  return t('daysAgo', { count: Math.floor(hrs / 24) })
}

export default function StudentSupportPage() {
  const t = useTranslations('student.support')
  const { user, loading: authLoading } = useAuth()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  // Con chi sta parlando l'allieva: nome e recapiti della scuola
  const [school, setSchool] = useState<{ name: string; email: string | null; phone: string | null; address: string | null; city: string | null } | null>(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [faqOpen, setFaqOpen] = useState<string | null>(null)

  const STATUS_LABELS: Record<string, string> = {
    open: t('statusOpen'),
    in_progress: t('statusInProgress'),
    resolved: t('statusResolved'),
  }

  const FAQ = [
    {
      category: t('faqCategoryBookings'),
      items: [
        { q: t('faqBookingsQ1'), a: t('faqBookingsA1') },
        { q: t('faqBookingsQ2'), a: t('faqBookingsA2') },
      ],
    },
    {
      category: t('faqCategoryPayments'),
      items: [
        { q: t('faqPaymentsQ1'), a: t('faqPaymentsA1') },
        { q: t('faqPaymentsQ2'), a: t('faqPaymentsA2') },
      ],
    },
    {
      category: t('faqCategoryDocuments'),
      items: [
        { q: t('faqDocumentsQ1'), a: t('faqDocumentsA1') },
      ],
    },
    {
      category: t('faqCategoryTechnical'),
      items: [
        { q: t('faqTechnicalQ1'), a: t('faqTechnicalA1') },
      ],
    },
  ]

  const openConversation = useCallback(async (convId: string) => {
    try {
      const [conv, msgs] = await Promise.all([
        apiFetch<{ school_name: string; school_email: string; school_phone: string; school_address: string; school_city: string }>(`/chat/conversations/${convId}/`),
        apiFetch<Message[]>(`/chat/conversations/${convId}/messages/`),
      ])
      setMessages(msgs)
      // La scuola con cui si sta parlando: recapiti mostrati a lato
      setSchool({
        name: conv.school_name, email: conv.school_email || null, phone: conv.school_phone || null,
        address: conv.school_address || null, city: conv.school_city || null,
      })
    } catch {
      setMessages([])
    }
    setActiveConvId(convId)
  }, [])

  const loadConversations = useCallback(async () => {
    try {
      const data = await apiFetch<Conversation[]>('/chat/conversations/')
      setConversations(data)
      const open = data.find((c) => c.status !== 'resolved')
      if (open) await openConversation(open.id)
    } catch {
      setConversations([])
    }
    setLoading(false)
  }, [openConversation])

  const startNewConversation = async () => {
    setStarting(true)
    try {
      const conv = await apiFetch<Conversation>('/chat/conversations/', {
        method: 'POST',
        body: JSON.stringify({ type: 'school_student' }),
      })
      setConversations((prev) => [conv, ...prev])
      await openConversation(conv.id)
    } catch {
      // no-op
    }
    setStarting(false)
  }

  useEffect(() => {
    if (authLoading || !user) return
    loadConversations()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user])

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-gray-500 text-sm mt-1">{t('subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Chat */}
        <div className="lg:col-span-2">
          {loading ? (
            <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
              {t('loading')}
            </div>
          ) : activeConvId ? (
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden" style={{ height: '520px' }}>
              <div className="border-b border-gray-100 px-4 py-3 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{school?.name ?? t('liveChat')}</p>
                  <p className="text-xs text-gray-400 truncate">
                    {school ? [school.address, school.city].filter(Boolean).join(', ') || t('liveChatDesc') : t('liveChatDesc')}
                  </p>
                </div>
                {conversations.length > 1 && (
                  <button
                    onClick={() => {
                      setActiveConvId(null)
                      setMessages([])
                    }}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    {t('allConversations')}
                  </button>
                )}
              </div>
              {user && (
                <div style={{ height: 'calc(100% - 57px)' }}>
                  <ChatWindow
                    conversationId={activeConvId}
                    currentUserRole="student"
                    initialMessages={messages}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
              <div className="text-4xl mb-3">💬</div>
              <h3 className="font-semibold text-gray-900 mb-1">{t('chatTitle')}</h3>
              <p className="text-sm text-gray-500 mb-4">{t('chatDesc')}</p>
              <button
                onClick={startNewConversation}
                disabled={starting}
                className="bg-brand text-white rounded-xl px-5 py-2.5 text-sm font-medium hover:bg-[#5a1931] transition disabled:opacity-50"
              >
                {starting ? t('startingConversation') : t('startConversation')}
              </button>

              {conversations.length > 0 && (
                <div className="mt-6 border-t border-gray-100 pt-4">
                  <p className="text-xs text-gray-400 mb-3">{t('previousConversations')}</p>
                  <div className="space-y-2">
                    {conversations.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => openConversation(c.id)}
                        className="w-full text-left flex items-center justify-between bg-gray-50 hover:bg-gray-100 rounded-lg px-3 py-2 transition"
                      >
                        <span className={`text-xs font-medium ${STATUS_COLORS[c.status] ?? 'text-gray-500'}`}>
                          {STATUS_LABELS[c.status] ?? c.status}
                        </span>
                        <span className="text-xs text-gray-400">
                          {timeAgo(c.last_message_at ?? c.created_at, (key, params) => t(key as Parameters<typeof t>[0], params as Parameters<typeof t>[1]))}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: la scuola + FAQ */}
        <div className="space-y-3">
          {/* Con chi stai parlando */}
          {school && (
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('yourSchool')}</h2>
              <p className="text-sm font-medium text-gray-900">{school.name}</p>
              {(school.address || school.city) && (
                <p className="text-xs text-gray-500 mt-0.5">{[school.address, school.city].filter(Boolean).join(', ')}</p>
              )}
              {school.phone && (
                <a href={`tel:${school.phone}`} className="text-xs text-brand hover:underline block mt-1.5">{school.phone}</a>
              )}
              {school.email && (
                <a href={`mailto:${school.email}`} className="text-xs text-brand hover:underline block truncate">{school.email}</a>
              )}
            </div>
          )}

          <h2 className="text-sm font-semibold text-gray-700">{t('faqTitle')}</h2>
          {FAQ.map((section) => (
            <div key={section.category} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {section.category}
                </span>
              </div>
              <div className="divide-y divide-gray-50">
                {section.items.map((item) => (
                  <div key={item.q}>
                    <button
                      onClick={() => setFaqOpen(faqOpen === item.q ? null : item.q)}
                      className="w-full text-left px-4 py-3 flex items-start justify-between gap-2 hover:bg-gray-50 transition"
                    >
                      <span className="text-sm text-gray-900">{item.q}</span>
                      <span className="text-gray-400 text-sm flex-shrink-0">
                        {faqOpen === item.q ? '−' : '+'}
                      </span>
                    </button>
                    {faqOpen === item.q && (
                      <div className="px-4 pb-3 text-sm text-gray-500 leading-relaxed">
                        {item.a}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="bg-brand/5 rounded-xl p-4 text-center">
            <p className="text-xs text-gray-500 mb-2">{t('stillNeedHelp')}</p>
            <button
              onClick={activeConvId ? undefined : startNewConversation}
              disabled={starting || !!activeConvId}
              className="text-xs font-medium text-brand hover:underline disabled:opacity-50"
            >
              {activeConvId ? t('chatIsOpen') : t('startChat')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
