'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import ChatWindow from '@/components/chat/ChatWindow'
import { useTranslations } from 'next-intl'
import { apiFetch } from '@/lib/api/client'
import { useAuth } from '@/lib/api/auth-context'

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

interface Conversation {
  id: string
  type: string
  status: string
  priority: string
  created_at: string
  last_message_at: string | null
  school: string | null
  student: string | null
  student_name: string
  student_email: string
  teacher: string | null
  teacher_name: string
  teacher_email: string
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
  const { user } = useAuth()
  const [conv, setConv] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([])
  const [studentInfo, setStudentInfo] = useState<StudentInfo | null>(null)
  const [studentProfile, setStudentProfile] = useState<StudentProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [showSidebar, setShowSidebar] = useState(true)

  const load = useCallback(async () => {
    type StudentDetail = {
      student: { id: string; name: string; email: string; phone: string | null }
      packages: { status: string; credits_remaining: number }[]
      subscriptions: { status: string }[]
    }

    const [convData, msgsData, qrData] = await Promise.all([
      apiFetch<Conversation>(`/chat/conversations/${id}/`).catch(() => null),
      apiFetch<Message[]>(`/chat/conversations/${id}/messages/`).catch(() => []),
      apiFetch<QuickReply[]>('/school/quick-replies/').catch(() => []),
    ])

    setConv(convData)
    setMessages(msgsData)
    setQuickReplies(qrData)

    if (convData?.type === 'school_student' && convData.student) {
      const detail = await apiFetch<StudentDetail>(`/school/students/detail/?student_id=${convData.student}`).catch(() => null)
      if (detail) {
        setStudentInfo(detail.student)
        const activePackages = detail.packages.filter(p => p.status === 'active')
        setStudentProfile({
          creditBalance: activePackages.reduce((sum, p) => sum + (p.credits_remaining ?? 0), 0),
          activePackages: activePackages.length,
          activeSubscriptions: detail.subscriptions.filter(s => s.status === 'active').length,
        })
      }
    }

    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  const updateConv = async (field: string, value: string) => {
    try {
      const updated = await apiFetch<Partial<Conversation>>(`/chat/conversations/${id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ [field]: value }),
      })
      setConv((prev) => prev ? { ...prev, ...updated } : prev)
    } catch { /* no-op */ }
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

  const isStudentConv = conv.type === 'school_student'
  const isTeacherConv = conv.type === 'school_teacher'

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/school/inbox" className="text-sm text-gray-400 hover:text-gray-600 transition whitespace-nowrap">
            {t('backToInbox')}
          </Link>
          <span className="text-gray-300">|</span>
          <div>
            <h1 className="text-base font-semibold text-gray-900">
              {isStudentConv
                ? (conv.student_name || t('unknownStudent'))
                : isTeacherConv
                ? (conv.teacher_name || t('unknownTeacher'))
                : t('hqTicket', { id: conv.id.slice(0, 8) })}
            </h1>
            {isStudentConv && conv.student_email && (
              <p className="text-xs text-gray-400">{conv.student_email}</p>
            )}
            {isTeacherConv && conv.teacher_email && (
              <p className="text-xs text-gray-400">{conv.teacher_email}</p>
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
              <option key={p} value={p}>{t(p === 'low' ? 'priorityLow' : p === 'high' ? 'priorityHigh' : 'priorityMedium')}</option>
            ))}
          </select>
          <select
            value={conv.status}
            onChange={(e) => updateConv('status', e.target.value)}
            className={`text-xs rounded-full px-2 py-0.5 border-0 cursor-pointer font-medium ${STATUS_COLORS[conv.status] ?? 'bg-gray-100 text-gray-500'}`}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{t(s === 'open' ? 'statusOpen' : s === 'resolved' ? 'statusResolved' : 'statusInProgress')}</option>
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
          {user && (
            <ChatWindow
              conversationId={id}
              currentUserRole="school"
              initialMessages={messages}
              quickReplies={quickReplies}
            />
          )}
        </div>

        {/* Student Sidebar */}
        {isStudentConv && showSidebar && studentInfo && (
          <div className="w-64 space-y-3 flex-shrink-0">
            {/* Student info */}
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{t('sidebarStudent')}</h3>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-[#6B1F3A]/10 flex items-center justify-center text-[#6B1F3A] font-semibold text-sm">
                  {studentInfo.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-medium text-gray-900 text-sm">{studentInfo.name}</p>
                  <p className="text-xs text-gray-400">{studentInfo.email}</p>
                </div>
              </div>
              {studentInfo.phone && (
                <p className="text-xs text-gray-500">{studentInfo.phone}</p>
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
                  href={`/school/students/${studentInfo.id}`}
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
