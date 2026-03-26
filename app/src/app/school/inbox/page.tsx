'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

interface Conversation {
  id: string
  type: string
  status: string
  priority: string
  created_at: string
  last_message_at: string | null
  school_id: string
  student_id: string | null
  students: { id: string; name: string; email: string } | null
}

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

export default function SchoolInboxPage() {
  const [tab, setTab] = useState<'hq_school' | 'school_student'>('school_student')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/chat/conversations?type=${tab}`)
    if (res.ok) {
      const data = await res.json()
      setConversations(data)
    }
    setLoading(false)
  }, [tab])

  useEffect(() => { load() }, [load])

  const startHQConversation = async () => {
    setCreating(true)
    const res = await fetch('/api/chat/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conv_type: 'hq_school' }),
    })
    if (res.ok) {
      const { id } = await res.json()
      window.location.href = `/school/inbox/${id}`
    }
    setCreating(false)
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inbox</h1>
          <p className="text-gray-500 text-sm mt-1">
            {tab === 'school_student' ? 'Conversations with students' : 'Conversations with HQ'}
          </p>
        </div>
        {tab === 'hq_school' && (
          <button
            onClick={startHQConversation}
            disabled={creating}
            className="bg-[#6B1F3A] text-white text-sm rounded-xl px-4 py-2 hover:bg-[#5a1931] transition disabled:opacity-50"
          >
            {creating ? 'Opening…' : '+ New HQ Ticket'}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1 w-fit">
        {(['school_student', 'hq_school'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-sm px-4 py-1.5 rounded-lg transition font-medium ${
              tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'school_student' ? 'Students' : 'HQ'}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
        ) : conversations.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">
            No conversations yet.
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">
                  {tab === 'school_student' ? 'Student' : 'Subject'}
                </th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Status</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Priority</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Last Activity</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {conversations.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50 transition">
                  <td className="px-6 py-3">
                    {tab === 'school_student' ? (
                      <div>
                        <p className="font-medium text-gray-900 text-sm">
                          {(c.students as { name: string } | null)?.name ?? 'Unknown Student'}
                        </p>
                        <p className="text-xs text-gray-400">
                          {(c.students as { email: string } | null)?.email}
                        </p>
                      </div>
                    ) : (
                      <p className="font-medium text-gray-900 text-sm">
                        Support Ticket #{c.id.slice(0, 8)}
                      </p>
                    )}
                  </td>
                  <td className="px-6 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[c.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {c.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${PRIORITY_COLORS[c.priority] ?? 'bg-gray-100 text-gray-500'}`}>
                      {c.priority}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-400">
                    {timeAgo(c.last_message_at ?? c.created_at)}
                  </td>
                  <td className="px-6 py-3 text-right">
                    <Link
                      href={`/school/inbox/${c.id}`}
                      className="text-xs text-[#6B1F3A] hover:underline"
                    >
                      Open →
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
