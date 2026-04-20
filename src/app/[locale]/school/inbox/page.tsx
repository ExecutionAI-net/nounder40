'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

interface Teacher { id: string; name: string; email: string }
interface Student { id: string; name: string; email: string }

interface Conversation {
  id: string
  type: string
  status: string
  priority: string
  created_at: string
  last_message_at: string | null
  school_id: string
  student_id: string | null
  teacher_id: string | null
  students: Student | null
  teachers: Teacher | null
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

type Tab = 'school_student' | 'school_teacher' | 'hq_school'

export default function SchoolInboxPage() {
  const [tab, setTab] = useState<Tab>('school_student')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [selectedTarget, setSelectedTarget] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/chat/conversations?type=${tab}`)
    if (res.ok) setConversations(await res.json())
    else setConversations([])
    setLoading(false)
  }, [tab])

  useEffect(() => { load() }, [load])

  const openModal = async () => {
    setSelectedTarget('')
    setShowModal(true)
    if (tab === 'school_teacher' && teachers.length === 0) {
      const res = await fetch('/api/school/teachers')
      if (res.ok) {
        const data = await res.json()
        setTeachers(Array.isArray(data.teachers)
          ? data.teachers.map((r: { teacher_id: string; teachers: Teacher | null }) => r.teachers).filter(Boolean)
          : [])
      }
    }
    if (tab === 'school_student' && students.length === 0) {
      const res = await fetch('/api/school/students')
      if (res.ok) {
        const data = await res.json()
        setStudents(Array.isArray(data) ? data : [])
      }
    }
  }

  const startConversation = async () => {
    if (!selectedTarget) return
    setCreating(true)
    const body = tab === 'school_teacher'
      ? { conv_type: 'school_teacher', teacher_id: selectedTarget }
      : tab === 'school_student'
      ? { conv_type: 'school_student', student_id: selectedTarget }
      : { conv_type: 'hq_school' }

    const res = await fetch('/api/chat/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      const { id } = await res.json()
      window.location.href = `/school/inbox/${id}`
    }
    setCreating(false)
  }

  const TAB_LABELS: Record<Tab, string> = {
    school_student: 'Students',
    school_teacher: 'Teachers',
    hq_school: 'HQ',
  }

  return (
    <div>
      {/* New Conversation Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 text-lg">New Message</h3>
              <p className="text-sm text-gray-400 mt-0.5">
                {tab === 'hq_school' ? 'Open a new ticket with HQ' : `Select a ${tab === 'school_teacher' ? 'teacher' : 'student'}`}
              </p>
            </div>
            <div className="px-6 py-4 space-y-4">
              {tab !== 'hq_school' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {tab === 'school_teacher' ? 'Teacher' : 'Student'}
                  </label>
                  <select
                    value={selectedTarget}
                    onChange={e => setSelectedTarget(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                  >
                    <option value="">Select…</option>
                    {tab === 'school_teacher'
                      ? teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)
                      : students.map(s => <option key={s.id} value={s.id}>{s.name} — {s.email}</option>)
                    }
                  </select>
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={startConversation}
                  disabled={(tab !== 'hq_school' && !selectedTarget) || creating}
                  className="flex-1 py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
                >
                  {creating ? 'Opening…' : 'Start Conversation'}
                </button>
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inbox</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {tab === 'school_student' ? 'Conversations with students' : tab === 'school_teacher' ? 'Conversations with teachers' : 'Conversations with HQ'}
          </p>
        </div>
        <button
          onClick={openModal}
          className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition"
        >
          + New Message
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1 w-fit">
        {(['school_student', 'school_teacher', 'hq_school'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-sm px-4 py-1.5 rounded-lg transition font-medium ${
              tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
        ) : conversations.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">No conversations yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">
                  {tab === 'school_student' ? 'Student' : tab === 'school_teacher' ? 'Teacher' : 'Subject'}
                </th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Status</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Priority</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Last Activity</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {conversations.map(c => (
                <tr key={c.id} className="hover:bg-gray-50 transition">
                  <td className="px-6 py-3">
                    {tab === 'school_student' && c.students ? (
                      <div>
                        <p className="font-medium text-gray-900">{c.students.name}</p>
                        <p className="text-xs text-gray-400">{c.students.email}</p>
                      </div>
                    ) : tab === 'school_teacher' && c.teachers ? (
                      <div>
                        <p className="font-medium text-gray-900">{c.teachers.name}</p>
                        <p className="text-xs text-gray-400">{c.teachers.email}</p>
                      </div>
                    ) : (
                      <p className="font-medium text-gray-900">HQ Ticket #{c.id.slice(0, 8)}</p>
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
                  <td className="px-6 py-3 text-gray-400">
                    {timeAgo(c.last_message_at ?? c.created_at)}
                  </td>
                  <td className="px-6 py-3 text-right">
                    <Link href={`/school/inbox/${c.id}`} className="text-xs text-[#6B1F3A] hover:underline">
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
