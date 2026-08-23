'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import MultiSelectFilter from '@/components/ui/MultiSelectFilter'
import { useTranslations, useLocale } from 'next-intl'
import { apiFetch } from '@/lib/api/client'
import { useAuth } from '@/lib/api/auth-context'
import { openSchoolCalendarSocket } from '@/lib/ws'

export type Lesson = {
  id: string
  date: string
  start_time: string
  end_time: string
  max_capacity: number
  current_bookings: number
  status: string
  course_id: string | null
  is_online: boolean
  courses: { name: string; color: string; credit_cost: number } | null
  lesson_types: { name_en: string } | null
  teachers: { name: string } | null
  school_rooms: { name: string; school_locations: { name: string } | null } | null
}

export type Closure = {
  id: string
  date: string
  end_date: string | null
  notes: string | null
}

export type TeacherOption = { id: string; name: string }
export type StudentOption = { id: string; name: string }
export type CourseOption = { id: string; name: string; color: string }

type ViewMode = 'day' | 'week' | 'month' | 'year'

// Etichette giorni nella lingua dell'utente (1-7 giugno 2026 = lun→dom)
function daysShort(locale: string): string[] {
  return [1, 2, 3, 4, 5, 6, 7].map(d =>
    new Date(2026, 5, d).toLocaleDateString(locale, { weekday: 'short' })
  )
}
// Nomi mese nella lingua dell'utente
function monthNames(locale: string): string[] {
  return Array.from({ length: 12 }, (_, m) =>
    new Date(2026, m, 1).toLocaleDateString(locale, { month: 'long' })
  )
}

function toISO(d: Date) {
  return d.toISOString().split('T')[0]
}

function getWeekDates(anchor: Date) {
  const day = anchor.getDay()
  const monday = new Date(anchor)
  monday.setDate(anchor.getDate() - ((day + 6) % 7))
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })
}

function getMonthDates(anchor: Date) {
  const year = anchor.getFullYear()
  const month = anchor.getMonth()
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const startOffset = (firstDay.getDay() + 6) % 7
  const totalCells = Math.ceil((startOffset + lastDay.getDate()) / 7) * 7
  return Array.from({ length: totalCells }, (_, i) => {
    const d = new Date(firstDay)
    d.setDate(1 - startOffset + i)
    return d
  })
}

function getRangeForMode(anchor: Date, mode: ViewMode): { from: string; to: string } {
  if (mode === 'day') {
    const s = toISO(anchor)
    return { from: s, to: s }
  }
  if (mode === 'week') {
    const dates = getWeekDates(anchor)
    return { from: toISO(dates[0]), to: toISO(dates[6]) }
  }
  if (mode === 'month') {
    const year = anchor.getFullYear()
    const month = anchor.getMonth()
    return {
      from: toISO(new Date(year, month, 1)),
      to: toISO(new Date(year, month + 1, 0)),
    }
  }
  const year = anchor.getFullYear()
  return { from: `${year}-01-01`, to: `${year}-12-31` }
}

function navigate(anchor: Date, mode: ViewMode, dir: -1 | 1): Date {
  const d = new Date(anchor)
  if (mode === 'day') d.setDate(d.getDate() + dir)
  else if (mode === 'week') d.setDate(d.getDate() + dir * 7)
  else if (mode === 'month') d.setMonth(d.getMonth() + dir)
  else d.setFullYear(d.getFullYear() + dir)
  return d
}

function headerLabel(anchor: Date, mode: ViewMode, uiLocale: string): string {
  if (mode === 'day') {
    return anchor.toLocaleDateString(uiLocale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  }
  if (mode === 'week') {
    const dates = getWeekDates(anchor)
    return `${dates[0].toLocaleDateString(uiLocale, { day: 'numeric', month: 'short' })} – ${dates[6].toLocaleDateString(uiLocale, { day: 'numeric', month: 'short', year: 'numeric' })}`
  }
  if (mode === 'month') {
    return anchor.toLocaleDateString(uiLocale, { month: 'long', year: 'numeric' })
  }
  return String(anchor.getFullYear())
}

/** Returns the Closure that covers the given ISO date string, or null */
function getClosureForDate(dateStr: string, closures: Closure[]): Closure | null {
  for (const c of closures) {
    const end = c.end_date ?? c.date
    if (dateStr >= c.date && dateStr <= end) return c
  }
  return null
}

interface Props {
  initialLessons: Lesson[]
  teacherOptions: TeacherOption[]
  studentOptions: StudentOption[]
  initialCourses: CourseOption[]
  initialClosures: Closure[]
}

export default function CalendarClient({ initialLessons, teacherOptions, studentOptions, initialCourses, initialClosures }: Props) {
  const t = useTranslations('school.calendar')
  const uiLocale = useLocale()
  const { user } = useAuth()
  const router = useRouter()
  const [anchor, setAnchor] = useState(() => new Date())
  // Su telefono la settimana a 7 colonne è illeggibile: si parte dal Giorno
  const [mode, setMode] = useState<ViewMode>(() =>
    typeof window !== 'undefined' && window.innerWidth < 768 ? 'day' : 'week'
  )
  const [lessons, setLessons] = useState<Lesson[]>(initialLessons)
  const [closures, setClosures] = useState<Closure[]>(initialClosures)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Lesson | null>(null)
  const isFirstRender = useRef(true)

  // Filters
  const [filterLocation, setFilterLocation] = useState<string[]>([])
  const [filterRoom, setFilterRoom] = useState<string[]>([])
  const [filterTeacher, setFilterTeacher] = useState<string[]>([])
  const [filterStudent, setFilterStudent] = useState('')
  const [studentLessonIds, setStudentLessonIds] = useState<Set<string> | null>(null)

  // Add Class from calendar
  const [showAddClass, setShowAddClass] = useState(false)
  const [courses, setCourses] = useState<CourseOption[]>(initialCourses)
  const [addForm, setAddForm] = useState({ course_id: '', date: '', start_time: '', duration_minutes: '60' })
  const [addingClass, setAddingClass] = useState(false)
  const [addClassError, setAddClassError] = useState<string | null>(null)

  // Enrolled students for selected class
  const [enrollments, setEnrollments] = useState<{ id: string; student_id: string; student: { name: string; email: string } | null }[]>([])
  const [enrollmentsLoading, setEnrollmentsLoading] = useState(false)

  useEffect(() => {
    if (!selected) { setEnrollments([]); return }
    setEnrollmentsLoading(true)
    apiFetch<{ enrollments?: typeof enrollments }>(`/school/classes/${selected.id}/`)
      .then(data => {
        setEnrollments(data.enrollments ?? [])
        setEnrollmentsLoading(false)
      })
      .catch(() => setEnrollmentsLoading(false))
  }, [selected])

  useEffect(() => {
    if (!filterStudent) { setStudentLessonIds(null); return }
    apiFetch<{ lesson_ids: string[] }>(`/school/student-lesson-ids/?student=${filterStudent}`)
      .then(data => setStudentLessonIds(new Set(data.lesson_ids)))
      .catch(() => setStudentLessonIds(null))
  }, [filterStudent])

  async function handleAddClass() {
    if (!addForm.course_id || !addForm.date || !addForm.start_time) return
    setAddingClass(true)
    setAddClassError(null)
    try {
      await apiFetch('/school/classes/', { method: 'POST', body: JSON.stringify({ ...addForm, frequency: 'single' }) })
    } catch {
      setAddClassError('Something went wrong')
      setAddingClass(false)
      return
    }
    setShowAddClass(false)
    setAddForm({ course_id: '', date: '', start_time: '', duration_minutes: '60' })
    setAddingClass(false)
    fetchLessons()
  }

  const { from, to } = getRangeForMode(anchor, mode)

  const fetchLessons = useCallback(async () => {
    setLoading(true)
    try {
      setLessons(await apiFetch<Lesson[]>(`/school/lessons-feed/?from=${from}&to=${to}`))
    } catch { /* keep previous lessons on error */ }
    setLoading(false)
  }, [from, to])

  // Fetch closures whenever the visible range changes (closures are school-wide, not date-limited but we refresh lazily)
  const fetchClosures = useCallback(async () => {
    try { setClosures(await apiFetch<Closure[]>('/school/closures/')) } catch { /* keep previous */ }
  }, [])

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    fetchLessons()
  }, [fetchLessons])

  useEffect(() => {
    fetchClosures()
  }, [fetchClosures])

  useEffect(() => {
    if (!user?.active_school) return
    const ws = openSchoolCalendarSocket(user.active_school, () => fetchLessons())
    return () => ws.close()
  }, [user?.active_school, fetchLessons])

  useEffect(() => {
    if (!showAddClass || courses.length > 0) return
    apiFetch<CourseOption[]>('/school/courses/?active=true')
      .then(data => setCourses(data.map(c => ({ id: c.id, name: c.name, color: c.color }))))
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAddClass])

  const locationOptions = [...new Set(
    lessons.map(l => l.school_rooms?.school_locations?.name).filter(Boolean)
  )] as string[]
  const roomOptions = [...new Set(
    lessons
      .filter(l => !filterLocation.length || filterLocation.includes(l.school_rooms?.school_locations?.name ?? ''))
      .map(l => l.school_rooms?.name)
      .filter(Boolean)
  )] as string[]

  const filteredLessons = lessons.filter(l => {
    if (filterLocation.length && !filterLocation.includes(l.school_rooms?.school_locations?.name ?? '')) return false
    if (filterRoom.length && !filterRoom.includes(l.school_rooms?.name ?? '')) return false
    if (filterTeacher.length && !filterTeacher.includes(l.teachers?.name ?? '')) return false
    if (filterStudent && studentLessonIds !== null && !studentLessonIds.has(l.id)) return false
    return true
  })

  const hasActiveFilter = !!(filterLocation.length || filterRoom.length || filterTeacher.length || filterStudent)

  function clearFilters() {
    setFilterLocation([])
    setFilterRoom([])
    setFilterTeacher([])
    setFilterStudent('')
  }

  function lessonsForDay(dateStr: string) {
    return filteredLessons.filter((l) => l.date === dateStr)
  }

  const today = toISO(new Date())

  return (
    <div>
      {/* Header — su mobile i controlli vanno a capo, niente elementi tagliati */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
          <p className="text-gray-500 text-sm mt-0.5">{headerLabel(anchor, mode, uiLocale)}</p>
        </div>
        <div className="flex items-center gap-2 md:gap-3 flex-wrap">
          <div className="flex bg-white border border-gray-200 rounded-lg p-1 gap-0.5">
            {(['day', 'week', 'month', 'year'] as ViewMode[]).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setSelected(null) }}
                className={`px-2.5 md:px-3 py-1.5 text-xs font-medium rounded transition ${
                  mode === m ? 'bg-[#6B1F3A] text-white' : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                {m === 'day' ? t('viewDay') : m === 'week' ? t('viewWeek') : m === 'month' ? t('viewMonth') : t('viewYear')}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1">
            <button onClick={() => setAnchor(navigate(anchor, mode, -1))} className="p-1.5 hover:bg-gray-100 rounded text-gray-500">←</button>
            <button
              onClick={() => setAnchor(new Date())}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded"
            >
              {mode === 'day' ? t('todayDay') : mode === 'week' ? t('todayWeek') : mode === 'month' ? t('todayMonth') : t('todayYear')}
            </button>
            <button onClick={() => setAnchor(navigate(anchor, mode, 1))} className="p-1.5 hover:bg-gray-100 rounded text-gray-500">→</button>
          </div>

          <button
            onClick={() => setShowAddClass(true)}
            className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition"
          >
            {t('addClass')}
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <MultiSelectFilter
          label={t('filterLocations')}
          options={locationOptions.map(l => ({ value: l, label: l }))}
          selected={filterLocation}
          onChange={(v) => { setFilterLocation(v); setFilterRoom([]) }}
        />
        <MultiSelectFilter
          label={t('filterRooms')}
          options={roomOptions.map(r => ({ value: r, label: r }))}
          selected={filterRoom}
          onChange={setFilterRoom}
        />
        <MultiSelectFilter
          label={t('filterTeachers')}
          options={teacherOptions.map(x => ({ value: x.name, label: x.name }))}
          selected={filterTeacher}
          onChange={setFilterTeacher}
        />

        <select
          value={filterStudent}
          onChange={e => setFilterStudent(e.target.value)}
          className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
        >
          <option value="">{t('allClients')}</option>
          {studentOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        {hasActiveFilter && (
          <button
            onClick={clearFilters}
            className="px-3 py-1.5 text-xs text-[#6B1F3A] border border-[#6B1F3A]/30 rounded-lg hover:bg-[#6B1F3A]/5 transition font-medium"
          >
            {t('clearFilters')}
          </button>
        )}

        {/* Closure legend */}
        {closures.length > 0 && (
          <div className="ml-auto flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="w-2.5 h-2.5 rounded-sm bg-amber-300" />
            <span className="text-xs text-amber-700 font-medium">{t('closureDay')}</span>
          </div>
        )}
      </div>

      {/* Add Class Modal */}
      {showAddClass && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <h3 className="font-semibold text-gray-900">Add Class to Existing Course</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Course *</label>
                <select value={addForm.course_id} onChange={e => setAddForm(f => ({ ...f, course_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20">
                  <option value="">Select course...</option>
                  {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Date *</label>
                <input type="date" value={addForm.date}
                  onChange={e => setAddForm(f => ({ ...f, date: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Start Time *</label>
                <input type="time" value={addForm.start_time}
                  onChange={e => setAddForm(f => ({ ...f, start_time: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Duration (min)</label>
                <input type="number" value={addForm.duration_minutes}
                  onChange={e => setAddForm(f => ({ ...f, duration_minutes: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20" />
              </div>
            </div>
            {addClassError && <p className="text-sm text-red-600">{addClassError}</p>}
            <div className="flex gap-2 pt-1">
              <button onClick={handleAddClass} disabled={addingClass || !addForm.course_id || !addForm.date || !addForm.start_time}
                className="flex-1 px-4 py-2 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium disabled:opacity-50">
                {addingClass ? 'Creating...' : 'Create Class'}
              </button>
              <button onClick={() => { setShowAddClass(false); setAddClassError(null) }}
                className="px-4 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-4">
        <div className="flex-1 min-w-0">
          {/* DAY VIEW */}
          {mode === 'day' && (() => {
            const dateStr = toISO(anchor)
            const closure = getClosureForDate(dateStr, closures)
            return (
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className={`p-4 border-b border-gray-100 ${closure ? 'bg-amber-50 border-amber-100' : today === dateStr ? 'bg-[#6B1F3A]/5' : ''}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-gray-700">
                      {anchor.toLocaleDateString(uiLocale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                    {closure && (
                      <span className="text-xs font-medium text-amber-700 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full">
                        🔒 {closure.notes ?? t('closed')}
                      </span>
                    )}
                  </div>
                </div>
                <div className={`p-4 min-h-64 ${closure ? 'bg-amber-50/30' : ''}`}>
                  {loading ? (
                    <p className="text-xs text-gray-300">{t('loading')}</p>
                  ) : lessonsForDay(dateStr).length === 0 ? (
                    <p className="text-sm text-gray-400 text-center mt-8">
                      {closure ? t('schoolClosed', { note: closure.notes ?? t('closed') }) : t('noClasses')}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {lessonsForDay(dateStr)
                        .sort((a, b) => a.start_time.localeCompare(b.start_time))
                        .map((l) => (
                          <button
                            key={l.id}
                            onClick={() => setSelected(l)}
                            className="w-full text-left rounded-xl px-4 py-3 text-sm transition hover:opacity-90 flex items-center gap-4"
                            style={{ backgroundColor: l.courses?.color ?? '#6B1F3A', color: '#fff' }}
                          >
                            <div className="text-xs opacity-80 w-16 shrink-0">
                              <p>{l.start_time.slice(0, 5)}</p>
                              <p>{l.end_time.slice(0, 5)}</p>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold truncate">{l.courses?.name ?? l.lesson_types?.name_en}{l.is_online ? ' 🌐' : ''}</p>
                              <p className="text-xs opacity-80 truncate">{l.teachers?.name ?? '—'} · {l.is_online ? 'Online' : (l.school_rooms?.name ?? '—')}</p>
                            </div>
                            <div className="text-xs opacity-70 shrink-0">{l.current_bookings}/{l.max_capacity}</div>
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })()}

          {/* WEEK VIEW — su mobile scorre in orizzontale, colonne leggibili */}
          {mode === 'week' && (
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden overflow-x-auto">
              <div className="min-w-[700px]">
              <div className="grid grid-cols-7 border-b border-gray-100">
                {getWeekDates(anchor).map((d, i) => {
                  const isToday = toISO(d) === today
                  const closure = getClosureForDate(toISO(d), closures)
                  return (
                    <div key={i} className={`p-3 text-center border-r border-gray-100 last:border-r-0 ${closure ? 'bg-amber-50' : isToday ? 'bg-[#6B1F3A]/5' : ''}`}>
                      <p className="text-xs text-gray-400 font-medium">{daysShort(uiLocale)[i]}</p>
                      <p className={`text-lg font-bold mt-0.5 ${isToday ? 'text-[#6B1F3A]' : closure ? 'text-amber-600' : 'text-gray-800'}`}>{d.getDate()}</p>
                      {closure && (
                        <p className="text-[10px] text-amber-600 mt-0.5 truncate" title={closure.notes ?? 'Closed'}>
                          🔒 {closure.notes ?? 'Closed'}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="grid grid-cols-7 min-h-96">
                {getWeekDates(anchor).map((d, i) => {
                  const dateStr = toISO(d)
                  const dayLessons = lessonsForDay(dateStr)
                  const isToday = dateStr === today
                  const closure = getClosureForDate(dateStr, closures)
                  return (
                    <div key={i} className={`p-2 border-r border-gray-100 last:border-r-0 space-y-1.5 ${closure ? 'bg-amber-50/40' : isToday ? 'bg-[#6B1F3A]/5' : ''}`}>
                      {loading && i === 0 && <div className="text-xs text-gray-300 mt-2">Loading...</div>}
                      {dayLessons.map((l) => (
                        <button
                          key={l.id}
                          onClick={() => setSelected(l)}
                          className="w-full text-left rounded-lg px-2 py-1.5 text-xs transition hover:opacity-80"
                          style={{ backgroundColor: l.courses?.color ?? '#6B1F3A', color: '#fff' }}
                        >
                          <p className="font-semibold truncate">{l.courses?.name ?? l.lesson_types?.name_en}</p>
                          <p className="opacity-80">{l.start_time.slice(0, 5)}{l.is_online ? ' · 🌐' : ''}</p>
                          <p className="opacity-70">{l.current_bookings}/{l.max_capacity}</p>
                        </button>
                      ))}
                    </div>
                  )
                })}
              </div>
              </div>
            </div>
          )}

          {/* MONTH VIEW — su mobile scorre in orizzontale */}
          {mode === 'month' && (
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden overflow-x-auto">
              <div className="min-w-[700px]">
              <div className="grid grid-cols-7 border-b border-gray-100">
                {daysShort(uiLocale).map((d) => (
                  <div key={d} className="p-3 text-center">
                    <p className="text-xs text-gray-400 font-medium">{d}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {getMonthDates(anchor).map((d, i) => {
                  const dateStr = toISO(d)
                  const inMonth = d.getMonth() === anchor.getMonth()
                  const isToday = dateStr === today
                  const dayLessons = lessonsForDay(dateStr)
                  const closure = inMonth ? getClosureForDate(dateStr, closures) : null
                  return (
                    <div
                      key={i}
                      className={`min-h-24 p-1.5 border-r border-b border-gray-100 last:border-r-0 ${
                        closure ? 'bg-amber-50/60' : !inMonth ? 'bg-gray-50/50' : isToday ? 'bg-[#6B1F3A]/5' : ''
                      }`}
                    >
                      <p className={`text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${
                        isToday ? 'bg-[#6B1F3A] text-white' : closure ? 'text-amber-600' : inMonth ? 'text-gray-700' : 'text-gray-300'
                      }`}>
                        {d.getDate()}
                      </p>
                      {loading && i === 0 ? null : (
                        <div className="space-y-0.5">
                          {closure && (
                            <div className="w-full text-left rounded px-1.5 py-0.5 text-[10px] bg-amber-100 text-amber-700 font-medium truncate border border-amber-200">
                              🔒 {closure.notes ?? 'Closed'}
                            </div>
                          )}
                          {dayLessons.slice(0, closure ? 2 : 3).map((l) => (
                            <button
                              key={l.id}
                              onClick={() => setSelected(l)}
                              className="w-full text-left rounded px-1.5 py-0.5 text-xs truncate transition hover:opacity-80"
                              style={{ backgroundColor: l.courses?.color ?? '#6B1F3A', color: '#fff' }}
                            >
                              {l.start_time.slice(0, 5)} {l.courses?.name ?? l.lesson_types?.name_en}
                            </button>
                          ))}
                          {dayLessons.length > (closure ? 2 : 3) && (
                            <p className="text-xs text-gray-400 pl-1">+{dayLessons.length - (closure ? 2 : 3)} more</p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              </div>
            </div>
          )}

          {/* YEAR VIEW */}
          {mode === 'year' && (
            <div className="grid grid-cols-4 gap-4">
              {monthNames(uiLocale).map((monthName, mi) => {
                const year = anchor.getFullYear()
                const firstDay = new Date(year, mi, 1)
                const lastDay = new Date(year, mi + 1, 0)
                const startOffset = (firstDay.getDay() + 6) % 7
                const totalCells = Math.ceil((startOffset + lastDay.getDate()) / 7) * 7
                const cells = Array.from({ length: totalCells }, (_, i) => {
                  const d = new Date(firstDay)
                  d.setDate(1 - startOffset + i)
                  return d
                })
                const monthLessons = filteredLessons.filter((l) => {
                  const lDate = new Date(l.date)
                  return lDate.getFullYear() === year && lDate.getMonth() === mi
                })
                const lessonDates = new Set(monthLessons.map((l) => l.date))

                return (
                  <div key={mi} className="bg-white rounded-xl border border-gray-100 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-gray-700">{monthName}</p>
                      {monthLessons.length > 0 && (
                        <span className="text-xs text-gray-400">{monthLessons.length} classes</span>
                      )}
                    </div>
                    <div className="grid grid-cols-7 mb-1">
                      {['M','T','W','T','F','S','S'].map((d, i) => (
                        <div key={i} className="text-center text-[10px] text-gray-300 font-medium">{d}</div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-y-0.5">
                      {cells.map((d, i) => {
                        const dateStr = toISO(d)
                        const inMonth = d.getMonth() === mi
                        const isToday = dateStr === today
                        const hasLesson = lessonDates.has(dateStr)
                        const closure = inMonth ? getClosureForDate(dateStr, closures) : null
                        return (
                          <button
                            key={i}
                            disabled={!inMonth || (!hasLesson && !closure)}
                            onClick={() => {
                              if (inMonth && (hasLesson || closure)) {
                                setAnchor(d)
                                setMode('day')
                              }
                            }}
                            title={closure?.notes ?? undefined}
                            className={`text-[10px] h-5 w-full flex items-center justify-center rounded transition ${
                              !inMonth ? 'text-gray-200' :
                              isToday ? 'bg-[#6B1F3A] text-white font-bold' :
                              closure ? 'bg-amber-200 text-amber-700 font-medium hover:bg-amber-300 cursor-pointer' :
                              hasLesson ? 'bg-[#6B1F3A]/15 text-[#6B1F3A] font-medium hover:bg-[#6B1F3A]/30 cursor-pointer' :
                              'text-gray-500'
                            }`}
                          >
                            {d.getDate()}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Scheda lezione: su mobile è un foglio in sovrapposizione che si
            chiude toccando fuori o con "Chiudi"; su desktop pannello laterale */}
        {selected && (
          <div
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end justify-center md:static md:z-auto md:bg-transparent md:backdrop-blur-none md:block md:self-start md:shrink-0"
            onClick={() => setSelected(null)}
          >
          <div
            className="w-full max-h-[85vh] overflow-y-auto rounded-t-2xl md:w-72 md:max-h-none md:overflow-visible md:rounded-xl bg-white border border-gray-100 p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div
                className="w-3 h-3 rounded-full mt-1 mr-2 shrink-0"
                style={{ backgroundColor: selected.courses?.color ?? '#6B1F3A' }}
              />
              <div className="flex-1">
                <p className="font-semibold text-gray-900 text-sm">{selected.courses?.name ?? selected.lesson_types?.name_en}</p>
                <p className="text-xs text-gray-400 mt-0.5">{selected.lesson_types?.name_en}</p>
              </div>
              <button
                onClick={() => setSelected(null)}
                aria-label={t('close')}
                className="w-8 h-8 -mt-1 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 text-xl leading-none transition"
              >
                ×
              </button>
            </div>

            <div className="space-y-2 text-sm">
              <Row label={t('rowDate')} value={new Date(selected.date + 'T12:00:00').toLocaleDateString(uiLocale, { weekday: 'long', day: 'numeric', month: 'long' })} />
              <Row label={t('rowTime')} value={`${selected.start_time.slice(0, 5)} – ${selected.end_time.slice(0, 5)}`} />
              <Row label={t('rowTeacher')} value={selected.teachers?.name ?? '—'} />
              <Row label={t('rowFormat')} value={selected.is_online ? '🌐 Online' : t('inPerson')} />
              {!selected.is_online && (
                <Row label={t('rowRoom')} value={
                  selected.school_rooms
                    ? `${selected.school_rooms.school_locations?.name ?? ''} · ${selected.school_rooms.name}`
                    : '—'
                } />
              )}
              <Row label={t('rowBookings')} value={`${selected.current_bookings} / ${selected.max_capacity}`} />
              <Row label={t('rowCredits')} value={String(selected.courses?.credit_cost ?? 1)} />
            </div>

            <div className={`text-xs px-2 py-1 rounded-full text-center font-medium ${
              selected.current_bookings >= selected.max_capacity
                ? 'bg-red-100 text-red-600'
                : 'bg-green-100 text-green-600'
            }`}>
              {selected.current_bookings >= selected.max_capacity ? t('full') : t('spotsAvailable', { count: selected.max_capacity - selected.current_bookings })}
            </div>

            <div className="border-t border-gray-100 pt-3 space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {t('enrolledStudents')}
              </p>
              {enrollmentsLoading ? (
                <p className="text-xs text-gray-300">Loading...</p>
              ) : enrollments.length === 0 ? (
                <p className="text-xs text-gray-300">{t('noStudentsEnrolled')}</p>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {enrollments.map(e => (
                    <div key={e.id} className="text-xs">
                      <p className="font-medium text-gray-800">{e.student?.name ?? '—'}</p>
                      <p className="text-gray-400">{e.student?.email ?? ''}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {selected.course_id && (
              <button
                onClick={() => router.push(`/school/courses/${selected.course_id}/classes/${selected.id}?from=calendar`)}
                className="w-full text-center text-xs text-[#6B1F3A] border border-[#6B1F3A]/30 rounded-lg py-2 hover:bg-[#6B1F3A]/5 transition font-medium"
              >
                {t('editClass')}
              </button>
            )}
            <button
              onClick={() => router.push(`/school/attendance/${selected.id}`)}
              className="w-full text-center text-xs text-white bg-gray-800 rounded-lg py-2 hover:bg-gray-700 transition font-medium"
            >
              {t('markAttendance')}
            </button>
            {/* Su mobile un'uscita esplicita, oltre al tocco fuori dal foglio */}
            <button
              onClick={() => setSelected(null)}
              className="md:hidden w-full text-center text-sm text-gray-600 border border-gray-200 rounded-lg py-2.5 hover:bg-gray-50 transition font-medium"
            >
              {t('close')}
            </button>
          </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-gray-400 text-xs">{label}</span>
      <span className="text-gray-800 text-xs text-right">{value}</span>
    </div>
  )
}
