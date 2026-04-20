'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
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

interface StudentInfo {
  id: string
  name: string
  email: string
  phone: string | null
}

interface TeacherInfo {
  id: string
  name: string
  email: string
}

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
  students: StudentInfo | null
  teachers: TeacherInfo | null
}

interface QuickReply {
  id: string
  title: string
  content: string
}

interface StudentProfile {
  creditBalance: number | null
  activePackages: number
  activeSubscriptions: number
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

export default function SchoolInboxDetailPage() {
  const t = useTranslations('school.inbox.detail')
  const { id } = useParams<{ id: string }>()
  const [conv, setConv] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([])
  const [studentProfile, setStudentProfile] = useState<StudentProfile | null>(null)
  const [currentUserId, setCurrentUserId] = useState('')
  const [loading, setLoading] = useState(true)
  const [showSidebar, setShowSidebar] = useState(true)

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) setCurrentUserId(user.id)

    const [convRes, qrRes] = await Promise.all([
      fetch(`/api/chat/conversations/${id}`),
      fetch('/api/chat/quick-replies'),
    ])

    if (convRes.ok) {
      const data = await convRes.json()
      setConv(data.conversation)
      setMessages(data.messages)

      // Load student profile if school_student type
      if (data.conversation?.type === 'school_student' && data.conversation?.student_id) {
        const sid = data.conversation.student_id
        const schoolId = data.conversation.school_id
        const supabaseClient = createClient()
        const [pkgRes, subRes] = await Promise.all([
          supabaseClient
            .from('student_packages')
            .select('credits_remaining')
            .eq('student_id', sid)
            .eq('school_id', schoolId)
            .eq('status', 'active'),
          supabaseClient
            .from('student_subscriptions')
            .select('id')
            .eq('student_id', sid)
            .eq('school_id', schoolId)
            .eq('status', 'active'),
        ])

        const totalCredits = (pkgRes.data ?? []).reduce(
          (sum: number, p: { credits_remaining: number }) => sum + (p.credits_remaining ?? 0),
          0
        )
        setStudentProfile({
          creditBalance: totalCredits,
          activePackages: pkgRes.data?.length ?? 0,
          activeSubscriptions: subRes.data?.length ?? 0,
        })
      }
    }

    if (qrRes.ok) {
      setQuickReplies(await qrRes.json())
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
    return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">{t('loading')}</div>
  }

  if (!conv) {
    return (
      <div className="text-center p-8">
        <p className="text-gray-500 text-sm">{t('notFound')}</p>
        <Link href="/school/inbox" className="text-[#6B1F3A] text-sm hover:underline mt-2 block">
          {t('backToInbox')}
        </Link>
      </div>
    )
  }

  const student = conv.students
  const teacher = conv.teachers
  const isStudentConv = conv.type === 'school_student'
  const isTeacherConv = conv.type === 'school_teacher'

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Link href="/school/inbox" className="text-sm text-gray-400 hover:text-gray-600 transition">
            {t('backToInbox')}
          </Link>
          <span className="text-gray-300">|</span>
          <div>
            <h1 className="text-base font-semibold text-gray-900">
              {isStudentConv
                ? (student?.name ?? t('unknownStudent'))
                : isTeacherConv
                ? (teacher?.name ?? t('unknownTeacher'))
                : t('hqTicket', { id: conv.id.slice(0, 8) })}
            </h1>
            {isStudentConv && student?.email && (
              <p className="text-xs text-gray-400">{student.email}</p>
            )}
            {isTeacherConv && teacher?.email && (
              <p className="text-xs text-gray-400">{teacher.email}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={conv.priority}
            onChange={(e) => updateConv('priority', e.target.value)}
            className={`text-xs rounded-full px-2 py-0.5 border-0 cursor-pointer font-medium ${PRIORITY_COLORS[conv.priority] ?? 'bg-gray-100 text-gray-500'}`}
          >
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select
            value={conv.status}
            onChange={(e) => updateConv('status', e.target.value)}
            className={`text-xs rounded-full px-2 py-0.5 border-0 cursor-pointer font-medium ${STATUS_COLORS[conv.status] ?? 'bg-gray-100 text-gray-500'}`}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s.replace('_', ' ')}</option>
            ))}
          </select>
          {isStudentConv && (
            <button
              onClick={() => setShowSidebar((v) => !v)}
              className="text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg px-2 py-1"
            >
              {showSidebar ? t('hideProfile') : t('showProfile')}
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* Chat */}
        <div className="flex-1 bg-white rounded-xl border border-gray-100 overflow-hidden flex flex-col">
          {currentUserId && (
            <ChatWindow
              conversationId={id}
              currentUserId={currentUserId}
              currentUserRole="school"
              initialMessages={messages}
              quickReplies={quickReplies}
            />
          )}
        </div>

        {/* Student Sidebar */}
        {isStudentConv && showSidebar && student && (
          <div className="w-64 space-y-3 flex-shrink-0">
            {/* Student info */}
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{t('sidebarStudent')}</h3>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-[#6B1F3A]/10 flex items-center justify-center text-[#6B1F3A] font-semibold text-sm">
                  {student.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-medium text-gray-900 text-sm">{student.name}</p>
                  <p className="text-xs text-gray-400">{student.email}</p>
                </div>
              </div>
              {student.phone && (
                <p className="text-xs text-gray-500">{student.phone}</p>
              )}
            </div>

            {/* Credits & Access */}
            {studentProfile && (
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{t('sidebarAccess')}</h3>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">{t('credits')}</span>
                    <span className="font-semibold text-gray-900">{studentProfile.creditBalance ?? 0}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">{t('activePackages')}</span>
                    <span className="font-semibold text-gray-900">{studentProfile.activePackages}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">{t('subscriptions')}</span>
                    <span className="font-semibold text-gray-900">{studentProfile.activeSubscriptions}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Quick actions */}
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{t('sidebarActions')}</h3>
              <div className="space-y-2">
                <Link
                  href={`/school/students/${student.id}`}
                  className="block text-xs text-center bg-gray-50 hover:bg-gray-100 text-gray-700 rounded-lg px-3 py-2 transition"
                >
                  {t('viewStudentProfile')}
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
