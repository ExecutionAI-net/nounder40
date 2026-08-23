'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useUnreadMessages } from '@/lib/use-unread'
import MultiSelectFilter from '@/components/ui/MultiSelectFilter'
import { apiFetch } from '@/lib/api/client'

interface Student { id: string; name: string; email: string }
interface Teacher { id: string; name: string; email: string }

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

// Nuovo (verde) → Aperta (azzurro) → Chiusa (grigio) — scelta di Carlo
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
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

type Tab = 'school_student' | 'school_teacher' | 'hq_school'

export default function SchoolInboxPage() {
  const t = useTranslations('school.inbox')
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('school_student')
  const unread = useUnreadMessages('school')
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<string[]>([])
  const [filterPriority, setFilterPriority] = useState<string[]>([])
  const [sortBy, setSortBy] = useState<'activity' | 'status' | 'priority'>('activity')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [selectedTarget, setSelectedTarget] = useState('')
  const [targetQuery, setTargetQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const TAB_LABELS: Record<Tab, string> = {
    school_student: t('tabStudents'),
    school_teacher: t('tabTeachers'),
    hq_school: t('tabHQ'),
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setConversations(await apiFetch<Conversation[]>(`/chat/conversations/?type=${tab}`))
    } catch {
      setConversations([])
    }
    setLoading(false)
  }, [tab])

  useEffect(() => { load() }, [load])

  const openModal = async () => {
    setSelectedTarget('')
    setTargetQuery('')
    setCreateError(null)
    setShowModal(true)
    if (tab === 'school_teacher' && teachers.length === 0) {
      type TeachersResponse = { teachers: { teachers: Teacher | null }[] }
      const data = await apiFetch<TeachersResponse>('/school/teachers/').catch((): TeachersResponse => ({ teachers: [] }))
      setTeachers((data.teachers ?? []).map(r => r.teachers).filter((t): t is Teacher => !!t))
    }
    if (tab === 'school_student' && students.length === 0) {
      type StudentRow = { students: Student | null }
      const data = await apiFetch<StudentRow[]>('/school/students/').catch(() => [])
      setStudents(data.map(r => r.students).filter((s): s is Student => !!s))
    }
  }

  const startConversation = async () => {
    if (tab !== 'hq_school' && !selectedTarget) return
    setCreating(true)
    setCreateError(null)
    const body = tab === 'school_teacher'
      ? { type: 'school_teacher', teacher: selectedTarget }
      : tab === 'school_student'
      ? { type: 'school_student', student: selectedTarget }
      : { type: 'hq_school' }

    try {
      const data = await apiFetch<{ id: string }>('/chat/conversations/', { method: 'POST', body: JSON.stringify(body) })
      window.location.href = `/school/inbox/${data.id}`
    } catch (err) {
      const body = err instanceof Object && 'body' in err ? (err as { body?: { error?: string } }).body : null
      setCreateError(body?.error ?? t('startFailed'))
      setCreating(false)
    }
  }

  // Ordine di urgenza: prima da leggere, poi in lavorazione, infine chiuse
  const STATUS_RANK: Record<string, number> = { open: 0, in_progress: 1, resolved: 2 }
  const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

  const nameOf = (c: Conversation) => c.student_name || c.teacher_name || ''
  const emailOf = (c: Conversation) => c.student_email || c.teacher_email || ''

  const query = search.trim().toLowerCase()
  const visible = conversations
    .filter(c => {
      if (query && !`${nameOf(c)} ${emailOf(c)}`.toLowerCase().includes(query)) return false
      if (filterStatus.length && !filterStatus.includes(c.status)) return false
      if (filterPriority.length && !filterPriority.includes(c.priority)) return false
      return true
    })
    .sort((a, b) => {
      if (sortBy === 'status') return (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9)
      if (sortBy === 'priority') return (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9)
      const at = new Date(a.last_message_at ?? a.created_at).getTime()
      const bt = new Date(b.last_message_at ?? b.created_at).getTime()
      return bt - at
    })

  const filtersActive = !!query || filterStatus.length > 0 || filterPriority.length > 0

  return (
    <div>
      {/* New Conversation Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 text-lg">{t('newMessage')}</h3>
              <p className="text-sm text-gray-400 mt-0.5">
                {tab === 'hq_school'
                  ? t('openHQTicket')
                  : tab === 'school_teacher' ? t('selectTargetTeacher') : t('selectTargetStudent')}
              </p>
            </div>
            <div className="px-6 py-4 space-y-4">
              {tab !== 'hq_school' && (() => {
                const people = tab === 'school_teacher' ? teachers : students
                const query = targetQuery.trim().toLowerCase()
                const matches = query
                  ? people.filter(p => `${p.name} ${p.email ?? ''}`.toLowerCase().includes(query))
                  : people
                const selected = people.find(p => p.id === selectedTarget)
                return (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {tab === 'school_teacher' ? t('labelTeacher') : t('labelStudent')}
                    </label>

                    {/* Ricerca per nome o email: gli elenchi possono essere lunghi */}
                    <input
                      value={selected && !targetQuery ? `${selected.name} — ${selected.email}` : targetQuery}
                      onChange={e => { setTargetQuery(e.target.value); setSelectedTarget('') }}
                      placeholder={t('searchPerson')}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                    />

                    <div className="mt-2 max-h-52 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-50">
                      {people.length === 0 ? (
                        <p className="px-3 py-3 text-xs text-gray-400">{t('noPeople')}</p>
                      ) : matches.length === 0 ? (
                        <p className="px-3 py-3 text-xs text-gray-400">{t('noMatches')}</p>
                      ) : (
                        matches.map(person => (
                          <button
                            key={person.id}
                            onClick={() => { setSelectedTarget(person.id); setTargetQuery('') }}
                            className={`w-full text-left px-3 py-2 transition ${
                              selectedTarget === person.id ? 'bg-[#6B1F3A]/10' : 'hover:bg-gray-50'
                            }`}
                          >
                            <p className="text-sm text-gray-800">{person.name}</p>
                            <p className="text-xs text-gray-400">{person.email}</p>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )
              })()}

              {createError && <p className="text-sm text-red-600">{createError}</p>}

              <div className="flex gap-3 pt-1">
                <button
                  onClick={startConversation}
                  disabled={(tab !== 'hq_school' && !selectedTarget) || creating}
                  className="flex-1 py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
                >
                  {creating ? t('opening') : t('startConversation')}
                </button>
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
                >
                  {t('cancel')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {tab === 'school_student' ? t('subtitleStudents') : tab === 'school_teacher' ? t('subtitleTeachers') : t('subtitleHQ')}
          </p>
        </div>
        <button
          onClick={openModal}
          className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition"
        >
          {t('newMessage')}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1 w-fit">
        {(['school_student', 'school_teacher', 'hq_school'] as Tab[]).map(tabKey => (
          <button
            key={tabKey}
            onClick={() => setTab(tabKey)}
            className={`text-sm px-4 py-1.5 rounded-lg transition font-medium flex items-center gap-2 ${
              tab === tabKey ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {TAB_LABELS[tabKey]}
            {(unread.byType[tabKey] ?? 0) > 0 && (
              <span className="min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center">
                {unread.byType[tabKey]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Ricerca, filtri e ordinamento: gli elenchi allieve diventano lunghi */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={tab === 'school_teacher' ? t('searchTeacher') : t('searchStudent')}
          className="flex-1 min-w-56 max-w-xs px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
        />
        <MultiSelectFilter
          label={t('colStatus')}
          selected={filterStatus}
          onChange={setFilterStatus}
          options={[
            { value: 'open', label: t('statusOpen') },
            { value: 'in_progress', label: t('statusInProgress') },
            { value: 'resolved', label: t('statusResolved') },
          ]}
        />
        <MultiSelectFilter
          label={t('colPriority')}
          selected={filterPriority}
          onChange={setFilterPriority}
          options={[
            { value: 'high', label: t('priorityHigh') },
            { value: 'medium', label: t('priorityMedium') },
            { value: 'low', label: t('priorityLow') },
          ]}
        />
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as typeof sortBy)}
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
        >
          <option value="activity">{t('sortActivity')}</option>
          <option value="status">{t('sortStatus')}</option>
          <option value="priority">{t('sortPriority')}</option>
        </select>
        {filtersActive && (
          <button
            onClick={() => { setSearch(''); setFilterStatus([]); setFilterPriority([]) }}
            className="text-xs text-gray-400 hover:text-gray-700 transition"
          >
            {t('clearFilters')}
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">{t('loading')}</div>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">{t('noConversations')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">
                  {tab === 'school_student' ? t('colStudent') : tab === 'school_teacher' ? t('colTeacher') : t('colSubject')}
                </th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('colStatus')}</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('colPriority')}</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('colLastActivity')}</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {visible.map(c => (
                <tr key={c.id} onClick={() => router.push(`/school/inbox/${c.id}`)} className="hover:bg-gray-50 transition cursor-pointer">
                  <td className="px-6 py-3 whitespace-nowrap">
                    {tab === 'school_student' && c.student_name ? (
                      <div>
                        <p className="font-medium text-gray-900">{c.student_name}</p>
                        <p className="text-xs text-gray-400">{c.student_email}</p>
                      </div>
                    ) : tab === 'school_teacher' && c.teacher_name ? (
                      <div>
                        <p className="font-medium text-gray-900">{c.teacher_name}</p>
                        <p className="text-xs text-gray-400">{c.teacher_email}</p>
                      </div>
                    ) : (
                      <p className="font-medium text-gray-900">{t('hqTicket', { id: c.id.slice(0, 8) })}</p>
                    )}
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
                    <Link href={`/school/inbox/${c.id}`} className="text-xs text-[#6B1F3A] hover:underline">
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
