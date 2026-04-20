'use client'

import { useEffect, useState, useCallback } from 'react'
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
  status: string
  created_at: string
  last_message_at: string | null
}

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
}

const STATUS_COLORS: Record<string, string> = {
  open: 'text-blue-600',
  in_progress: 'text-yellow-600',
  resolved: 'text-green-600',
}

function timeAgo(iso: string | null) {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

const FAQ = [
  {
    category: 'Bookings',
    items: [
      {
        q: 'How do I cancel a booking?',
        a: 'Go to My Bookings → Upcoming, and click Cancel on the lesson. Credits are refunded if you cancel before the policy deadline.',
      },
      {
        q: 'Can I book lessons at multiple schools?',
        a: 'Yes! You can book at any school, but each school has separate credits and subscriptions.',
      },
    ],
  },
  {
    category: 'Payments',
    items: [
      {
        q: 'How do I buy a package?',
        a: 'Go to My Packages → Purchase, select your school, and choose a package. You can pay via card through Stripe.',
      },
      {
        q: 'Do unused credits roll over?',
        a: 'No. Credits expire with the package on the expiry date. Make sure to use them before they expire.',
      },
    ],
  },
  {
    category: 'Documents',
    items: [
      {
        q: 'Why is my booking blocked?',
        a: 'Your medical certificate may have expired. Upload a new one from your Profile → Documents tab.',
      },
    ],
  },
  {
    category: 'Technical',
    items: [
      {
        q: 'How do I add the app to my phone?',
        a: 'Open the site in your browser, tap the Share button, and select "Add to Home Screen".',
      },
    ],
  },
]

export default function StudentSupportPage() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [currentUserId, setCurrentUserId] = useState('')
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [faqOpen, setFaqOpen] = useState<string | null>(null)

  const loadConversations = useCallback(async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) setCurrentUserId(user.id)

    const res = await fetch('/api/chat/conversations')
    if (res.ok) {
      const data = await res.json()
      setConversations(data)
      // Auto-open the most recent open conversation
      const open = data.find((c: Conversation) => c.status !== 'resolved')
      if (open) {
        openConversation(open.id)
      }
    }
    setLoading(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const openConversation = async (convId: string) => {
    setActiveConvId(convId)
    const res = await fetch(`/api/chat/conversations/${convId}`)
    if (res.ok) {
      const data = await res.json()
      setMessages(data.messages)
    }
  }

  const startNewConversation = async () => {
    setStarting(true)
    const res = await fetch('/api/chat/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (res.ok) {
      const conv = await res.json()
      setConversations((prev) => [conv, ...prev])
      await openConversation(conv.id)
    }
    setStarting(false)
  }

  useEffect(() => { loadConversations() }, [loadConversations])

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Support</h1>
        <p className="text-gray-500 text-sm mt-1">Chat with your school or browse FAQs</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Chat */}
        <div className="lg:col-span-2">
          {loading ? (
            <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
              Loading…
            </div>
          ) : activeConvId ? (
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden" style={{ height: '520px' }}>
              {/* Conversation header */}
              <div className="border-b border-gray-100 px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Live Chat</p>
                  <p className="text-xs text-gray-400">Messages are answered by your school team</p>
                </div>
                {conversations.length > 1 && (
                  <button
                    onClick={() => {
                      setActiveConvId(null)
                      setMessages([])
                    }}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    All conversations
                  </button>
                )}
              </div>
              {currentUserId && (
                <div style={{ height: 'calc(100% - 57px)' }}>
                  <ChatWindow
                    conversationId={activeConvId}
                    currentUserId={currentUserId}
                    currentUserRole="student"
                    initialMessages={messages}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
              <div className="text-4xl mb-3">💬</div>
              <h3 className="font-semibold text-gray-900 mb-1">Chat with your school</h3>
              <p className="text-sm text-gray-500 mb-4">
                Have a question? Start a conversation and get help from your school team.
              </p>
              <button
                onClick={startNewConversation}
                disabled={starting}
                className="bg-[#6B1F3A] text-white rounded-xl px-5 py-2.5 text-sm font-medium hover:bg-[#5a1931] transition disabled:opacity-50"
              >
                {starting ? 'Starting…' : 'Start a conversation'}
              </button>

              {/* Previous conversations */}
              {conversations.length > 0 && (
                <div className="mt-6 border-t border-gray-100 pt-4">
                  <p className="text-xs text-gray-400 mb-3">Previous conversations</p>
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
                          {timeAgo(c.last_message_at ?? c.created_at)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: FAQ */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">Frequently Asked Questions</h2>
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

          {/* Contact */}
          <div className="bg-[#6B1F3A]/5 rounded-xl p-4 text-center">
            <p className="text-xs text-gray-500 mb-2">Still need help?</p>
            <button
              onClick={activeConvId ? undefined : startNewConversation}
              disabled={starting || !!activeConvId}
              className="text-xs font-medium text-[#6B1F3A] hover:underline disabled:opacity-50"
            >
              {activeConvId ? 'Chat is open ↑' : 'Start a chat'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
