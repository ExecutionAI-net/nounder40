'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { apiFetch } from '@/lib/api/client'
import { timeAgo } from '@/lib/time-ago'

interface Conversation {
  id: string
  status: string
  priority: string
  created_at: string
  last_message_at: string | null
  school: string | null
  school_name: string
}

type Tab = 'school_teacher' | 'teacher_support'

// Nuovo (verde) → Aperta (azzurro) → Chiusa (grigio) — come l'inbox scuola
const STATUS_COLORS: Record<string, string> = {
  open: 'bg-green-100 text-green-700',
  in_progress: 'bg-sky-100 text-sky-700',
  resolved: 'bg-gray-100 text-gray-500',
}

export default function TeacherInboxPage() {
  const t = useTranslations('teacher.inbox')
  const uiLocale = useLocale()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('school_teacher')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)

  const load = useCallback(async (type: Tab) => {
    setLoading(true)
    try {
      setConversations(await apiFetch<Conversation[]>(`/chat/conversations/?type=${type}`))
    } catch {
      setConversations([])
    }
    setLoading(false)
  }, [])

  useEffect(() => { load(tab) }, [load, tab])

  // Un thread per volta con quella controparte: se ce n'è già uno non
  // risolto, lo si riapre invece di crearne un secondo (stesso pattern di
  // student/support).
  const startNewMessage = async () => {
    const existing = conversations.find(c => c.status !== 'resolved')
    if (existing) {
      router.push(`/teacher/inbox/${existing.id}`)
      return
    }
    setStarting(true)
    try {
      const conv = await apiFetch<Conversation>('/chat/conversations/', {
        method: 'POST',
        body: JSON.stringify({ type: tab }),
      })
      router.push(`/teacher/inbox/${conv.id}`)
    } catch {
      // no-op — l'utente può ritentare
    }
    setStarting(false)
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
          <p className="text-gray-500 text-sm mt-0.5">{t('selectConversation')}</p>
        </div>
        <button
          onClick={startNewMessage}
          disabled={starting}
          className="px-4 py-2 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] disabled:opacity-50 transition"
        >
          {t('newMessage')}
        </button>
      </div>

      <div className="flex gap-1 mb-4 border-b border-gray-100">
        {(['school_teacher', 'teacher_support'] as const).map(key => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              tab === key ? 'border-[#6B1F3A] text-[#6B1F3A]' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            {key === 'school_teacher' ? t('tabSchool') : t('tabHqSupport')}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">{t('loading')}</div>
        ) : conversations.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">{t('noConversations')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide whitespace-nowrap">
                  {tab === 'school_teacher' ? t('colSchool') : t('hqSupportLabel')}
                </th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide whitespace-nowrap">{t('colStatus')}</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide whitespace-nowrap">{t('colLastActivity')}</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {conversations.map(c => (
                <tr key={c.id} onClick={() => router.push(`/teacher/inbox/${c.id}`)} className="hover:bg-gray-50 transition cursor-pointer">
                  <td className="px-6 py-3 font-medium text-gray-900 whitespace-nowrap">
                    {tab === 'school_teacher' ? (c.school_name || '—') : t('hqSupportLabel')}
                  </td>
                  <td className="px-6 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLORS[c.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {t(`status${c.status === 'in_progress' ? 'InProgress' : c.status === 'resolved' ? 'Resolved' : 'Open'}` as Parameters<typeof t>[0])}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-gray-400 whitespace-nowrap">
                    {timeAgo(c.last_message_at ?? c.created_at, uiLocale)}
                  </td>
                  <td className="px-6 py-3 text-right">
                    <Link href={`/teacher/inbox/${c.id}`} className="text-xs text-[#6B1F3A] hover:underline">
                      {t('open')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
