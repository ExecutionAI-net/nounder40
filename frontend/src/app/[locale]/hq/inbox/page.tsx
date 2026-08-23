'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { apiFetch } from '@/lib/api/client'

interface School {
  id: string
  name: string
  city: string
  email: string
}

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

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-gray-100 text-gray-500',
  medium: 'bg-orange-100 text-orange-600',
  high: 'bg-red-100 text-red-600',
}

function timeAgo(iso: string | null) {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

export default function HQInboxPage() {
  const t = useTranslations('hq.inbox')
  const router = useRouter()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [schools, setSchools] = useState<School[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [selectedSchool, setSelectedSchool] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [conv, schoolList] = await Promise.all([
      apiFetch<Conversation[]>('/chat/conversations/?type=hq_school').catch(() => []),
      apiFetch<School[]>('/hq/schools/').catch(() => []),
    ])
    setConversations(conv)
    setSchools(schoolList)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const startConversation = async () => {
    if (!selectedSchool) return
    setCreating(true)
    try {
      const data = await apiFetch<{ id: string }>('/chat/conversations/', {
        method: 'POST',
        body: JSON.stringify({ type: 'hq_school', school: selectedSchool }),
      })
      window.location.href = `/hq/inbox/${data.id}`
    } catch {
      setCreating(false)
    }
  }

  return (
    <div>
      {/* New Conversation Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 text-lg">{t('modalTitle')}</h3>
              <p className="text-sm text-gray-400 mt-0.5">{t('modalSubtitle')}</p>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('labelSchool')}</label>
                <select
                  value={selectedSchool}
                  onChange={e => setSelectedSchool(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                >
                  <option value="">{t('selectSchool')}</option>
                  {schools.map(s => (
                    <option key={s.id} value={s.id}>{s.name} — {s.city} ({s.email})</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  onClick={startConversation}
                  disabled={!selectedSchool || creating}
                  className="flex-1 py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
                >
                  {creating ? t('buttonOpening') : t('buttonStartConversation')}
                </button>
                <button
                  onClick={() => { setShowModal(false); setSelectedSchool('') }}
                  className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
                >
                  {t('buttonCancel')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
          <p className="text-gray-500 text-sm mt-0.5">{t('subtitle')}</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition"
        >
          {t('buttonNewMessage')}
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">{t('loading')}</div>
        ) : conversations.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">{t('emptyState')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide whitespace-nowrap">{t('headerSchool')}</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide whitespace-nowrap">{t('headerStatus')}</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide whitespace-nowrap">{t('headerPriority')}</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide whitespace-nowrap">{t('headerLastActivity')}</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {conversations.map(c => (
                <tr key={c.id} onClick={() => router.push(`/hq/inbox/${c.id}`)} className="hover:bg-gray-50 transition cursor-pointer">
                  <td className="px-6 py-3 font-medium text-gray-900 whitespace-nowrap">
                    {c.school_name || '—'}
                  </td>
                  <td className="px-6 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLORS[c.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {t(`status${c.status === 'in_progress' ? 'InProgress' : c.status === 'resolved' ? 'Resolved' : 'Open'}` as Parameters<typeof t>[0])}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${PRIORITY_COLORS[c.priority] ?? 'bg-gray-100 text-gray-500'}`}>
                      {t(`priority${c.priority === 'high' ? 'High' : c.priority === 'low' ? 'Low' : 'Medium'}` as Parameters<typeof t>[0])}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-gray-400 whitespace-nowrap">
                    {timeAgo(c.last_message_at ?? c.created_at)}
                  </td>
                  <td className="px-6 py-3 text-right">
                    <Link href={`/hq/inbox/${c.id}`} className="text-xs text-[#6B1F3A] hover:underline">
                      {t('actionOpen')}
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
