'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { apiFetch } from '@/lib/api/client'

interface Conversation {
  id: string
  status: string
  priority: string
  created_at: string
  last_message_at: string | null
  school: string | null
  school_name: string
}

// Nuovo (verde) → Aperta (azzurro) → Chiusa (grigio) — come l'inbox scuola
const STATUS_COLORS: Record<string, string> = {
  open: 'bg-green-100 text-green-700',
  in_progress: 'bg-sky-100 text-sky-700',
  resolved: 'bg-gray-100 text-gray-500',
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

export default function TeacherInboxPage() {
  const t = useTranslations('teacher.inbox')
  const router = useRouter()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setConversations(await apiFetch<Conversation[]>('/chat/conversations/?type=school_teacher'))
    } catch {
      setConversations([])
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-gray-500 text-sm mt-0.5">{t('selectConversation')}</p>
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
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide whitespace-nowrap">{t('colSchool')}</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide whitespace-nowrap">{t('colStatus')}</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide whitespace-nowrap">{t('colLastActivity')}</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {conversations.map(c => (
                <tr key={c.id} onClick={() => router.push(`/teacher/inbox/${c.id}`)} className="hover:bg-gray-50 transition cursor-pointer">
                  <td className="px-6 py-3 font-medium text-gray-900 whitespace-nowrap">
                    {c.school_name || '—'}
                  </td>
                  <td className="px-6 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLORS[c.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {t(`status${c.status === 'in_progress' ? 'InProgress' : c.status === 'resolved' ? 'Resolved' : 'Open'}` as Parameters<typeof t>[0])}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-gray-400 whitespace-nowrap">
                    {timeAgo(c.last_message_at ?? c.created_at)}
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
