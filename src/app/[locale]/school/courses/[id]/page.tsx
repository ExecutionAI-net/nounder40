'use client'

import { useEffect, useState, use, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

interface ClassRow {
  id: string
  date: string
  start_time: string
  end_time: string
  max_capacity: number
  current_bookings: number
  status: string
  notes: string | null
  teachers: { id: string; name: string } | null
  school_rooms: { id: string; name: string; school_locations: { name: string } | null } | null
}

interface Course {
  id: string
  name: string
  color: string
  frequency: string
  start_time: string
  duration_minutes: number
  notes: string | null
  lesson_types: { name_en: string } | null
  teachers: { name: string } | null
}

type Filter = 'upcoming' | 'past' | 'all'

export default function CourseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const t = useTranslations('school.courses.detail')
  const supabase = createClient()

  const [course, setCourse] = useState<Course | null>(null)
  const [classes, setClasses] = useState<ClassRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('upcoming')
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkCancelling, setBulkCancelling] = useState(false)
  const [showBulkConfirm, setShowBulkConfirm] = useState(false)

  // Filters
  const [filterTeacher, setFilterTeacher] = useState('')
  const [filterRoom, setFilterRoom] = useState('')
  const [filterStartHour, setFilterStartHour] = useState('')

  // Add class modal
  const [showAddClass, setShowAddClass] = useState(false)
  const [addForm, setAddForm] = useState({
    date: '', start_time: '', duration_minutes: '60',
    teacher_id: '', room_id: '', max_capacity: '', credit_cost: '',
    frequency: 'single', end_date: '', compensation_plan_id: '', notes: '',
  })
  const [teachers, setTeachers] = useState<{ id: string; name: string }[]>([])
  const [rooms, setRooms] = useState<{ id: string; name: string; location_name: string }[]>([])
  const [addingClass, setAddingClass] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [plans, setPlans] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    loadAll()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function loadAll() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
    if (!profile?.school_id) return

    const [courseRes, classesRes, teachersRes, locRes, plansRes] = await Promise.all([
      supabase.from('courses').select(`
        id, name, color, frequency, start_time, duration_minutes, notes,
        lesson_types(name_en), teachers(name)
      `).eq('id', id).eq('school_id', profile.school_id).single(),
      supabase.from('lessons').select(`
        id, date, start_time, end_time, max_capacity, current_bookings, status, notes,
        teachers(id, name),
        school_rooms(id, name, school_locations(name))
      `).eq('course_id', id).neq('status', 'cancelled').order('date', { ascending: true }),
      supabase.from('teachers').select('id, name').eq('school_id', profile.school_id).eq('active', true).order('name'),
      supabase.from('school_locations').select('id, name, school_rooms(id, name, capacity)').eq('school_id', profile.school_id),
      fetch('/api/school/compensation-plans').then(r => r.ok ? r.json() : []),
    ])

    if (courseRes.data) setCourse(courseRes.data as Course)
    setClasses(classesRes.data ?? [])
    setTeachers(teachersRes.data ?? [])
    setPlans(Array.isArray(plansRes) ? plansRes : [])

    const flatRooms: { id: string; name: string; location_name: string }[] = []
    for (const loc of locRes.data ?? []) {
      for (const room of (loc.school_rooms as { id: string; name: string }[] ?? [])) {
        flatRooms.push({ id: room.id, name: room.name, location_name: loc.name })
      }
    }
    setRooms(flatRooms)
    setLoading(false)
  }

  async function handleCancelClass(classId: string) {
    setCancellingId(classId)
    setError(null)
    const res = await fetch(`/api/school/classes/${classId}`, { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) { setError(data.error); setCancellingId(null); return }
    setClasses(prev => prev.filter(c => c.id !== classId))
    setCancellingId(null)
  }

  async function handleBulkCancel() {
    setBulkCancelling(true)
    setShowBulkConfirm(false)
    setError(null)
    for (const classId of selected) {
      await fetch(`/api/school/classes/${classId}`, { method: 'DELETE' })
    }
    setSelected(new Set())
    setBulkCancelling(false)
    loadAll()
  }

  async function handleAddClass() {
    if (!addForm.date || !addForm.start_time) return
    setAddingClass(true)
    setAddError(null)

    const body: Record<string, unknown> = {
      course_id: id,
      date: addForm.date,
      start_time: addForm.start_time,
      duration_minutes: addForm.duration_minutes,
      frequency: addForm.frequency,
    }
    if (addForm.teacher_id) body.teacher_id = addForm.teacher_id
    if (addForm.room_id) body.room_id = addForm.room_id
    if (addForm.max_capacity) body.max_capacity = addForm.max_capacity
    if (addForm.credit_cost) body.credit_cost = addForm.credit_cost
    if (addForm.frequency !== 'single' && addForm.end_date) body.end_date = addForm.end_date
    if (addForm.compensation_plan_id) body.compensation_plan_id = addForm.compensation_plan_id
    if (addForm.notes) body.notes = addForm.notes

    const res = await fetch('/api/school/classes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) { setAddError(data.error); setAddingClass(false); return }
    setShowAddClass(false)
    setAddForm({ date: '', start_time: '', duration_minutes: '60', teacher_id: '', room_id: '', max_capacity: '', credit_cost: '', frequency: 'single', end_date: '', compensation_plan_id: '', notes: '' })
    setAddingClass(false)
    loadAll()
  }

  function toggleSelect(classId: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(classId) ? next.delete(classId) : next.add(classId)
      return next
    })
  }

  function toggleSelectAll() {
    if (selected.size === filteredClasses.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filteredClasses.map(c => c.id)))
    }
  }

  const today = new Date().toISOString().split('T')[0]

  // Derived filter options
  const uniqueTeachers = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of classes) {
      if (c.teachers?.id && c.teachers?.name) map.set(c.teachers.id, c.teachers.name)
    }
    return Array.from(map.entries()).map(([tid, name]) => ({ id: tid, name }))
  }, [classes])

  const uniqueRooms = useMemo(() => {
    const map = new Map<string, { id: string; name: string; location: string }>()
    for (const c of classes) {
      if (c.school_rooms?.id) map.set(c.school_rooms.id, {
        id: c.school_rooms.id,
        name: c.school_rooms.name,
        location: c.school_rooms.school_locations?.name ?? '',
      })
    }
    return Array.from(map.values())
  }, [classes])

  const uniqueStartHours = useMemo(() => {
    const set = new Set<string>()
    for (const c of classes) {
      if (c.start_time) set.add(c.start_time.slice(0, 5))
    }
    return Array.from(set).sort()
  }, [classes])

  const filteredClasses = useMemo(() => {
    return classes.filter(c => {
      if (filter === 'upcoming' && c.date < today) return false
      if (filter === 'past' && c.date >= today) return false
      if (filterTeacher && c.teachers?.id !== filterTeacher) return false
      if (filterRoom && c.school_rooms?.id !== filterRoom) return false
      if (filterStartHour && c.start_time?.slice(0, 5) !== filterStartHour) return false
      return true
    })
  }, [classes, filter, filterTeacher, filterRoom, filterStartHour, today])

  const allSelected = filteredClasses.length > 0 && selected.size === filteredClasses.length
  const someSelected = selected.size > 0
  const hasActiveFilters = filterTeacher || filterRoom || filterStartHour

  if (loading) return <div className="text-sm text-gray-400">{t('loading')}</div>
  if (!course) return <div className="text-sm text-gray-400">{t('notFound')}</div>

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 rounded-full shrink-0 mt-1" style={{ backgroundColor: course.color }} />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{course.name}</h1>
            <p className="text-gray-500 text-sm mt-0.5">
              {course.lesson_types?.name_en ?? '—'} · {course.frequency} · {course.start_time?.slice(0, 5)} · {course.duration_minutes}min
              {course.teachers?.name ? ` · ${course.teachers.name}` : ''}
            </p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={() => setShowAddClass(true)}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700 transition">
            {t('addClass')}
          </button>
          <Link href={`/school/courses/${id}/edit`}
            className="px-4 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50 transition">
            {t('editCourse')}
          </Link>
          <Link href="/school/courses"
            className="px-4 py-2 border border-gray-200 text-gray-400 rounded-lg text-sm hover:bg-gray-50 transition">
            {t('back')}
          </Link>
        </div>
      </div>

      {course.notes && (
        <div className="px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-lg text-sm text-gray-600">
          {course.notes}
        </div>
      )}

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>}

      {/* Add Class Modal */}
      {showAddClass && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h3 className="font-semibold text-gray-900">{t('addClassTitle')}</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('labelDate')}</label>
              <input type="date" value={addForm.date} onChange={e => setAddForm(f => ({ ...f, date: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('labelStartTime')}</label>
              <input type="time" value={addForm.start_time} onChange={e => setAddForm(f => ({ ...f, start_time: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('labelDuration')}</label>
              <input type="number" value={addForm.duration_minutes} onChange={e => setAddForm(f => ({ ...f, duration_minutes: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('labelFrequency')}</label>
              <select value={addForm.frequency} onChange={e => setAddForm(f => ({ ...f, frequency: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20">
                <option value="single">{t('freqSingle')}</option>
                <option value="weekly">{t('freqWeekly')}</option>
                <option value="biweekly">{t('freqBiweekly')}</option>
              </select>
            </div>
            {addForm.frequency !== 'single' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">{t('labelEndDate')}</label>
                <input type="date" value={addForm.end_date} onChange={e => setAddForm(f => ({ ...f, end_date: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20" />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('labelTeacherOverride')}</label>
              <select value={addForm.teacher_id} onChange={e => setAddForm(f => ({ ...f, teacher_id: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20">
                <option value="">{t('useCourseDefault')}</option>
                {teachers.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('labelRoomOverride')}</label>
              <select value={addForm.room_id} onChange={e => setAddForm(f => ({ ...f, room_id: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20">
                <option value="">{t('useCourseDefault')}</option>
                {rooms.map(r => <option key={r.id} value={r.id}>{r.location_name} — {r.name}</option>)}
              </select>
            </div>
            {plans.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">{t('labelCompPlan')}</label>
                <select value={addForm.compensation_plan_id} onChange={e => setAddForm(f => ({ ...f, compensation_plan_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20">
                  <option value="">{t('noPlan')}</option>
                  {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('labelNotes')}</label>
              <textarea value={addForm.notes} onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))}
                rows={3} placeholder={t('notesPlaceholder')}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20 resize-none" />
            </div>
          </div>
          {addError && <p className="text-sm text-red-600">{addError}</p>}
          <div className="flex gap-2">
            <button onClick={handleAddClass} disabled={addingClass || !addForm.date || !addForm.start_time}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium disabled:opacity-50">
              {addingClass ? t('creating') : t('createClass')}
            </button>
            <button onClick={() => setShowAddClass(false)} className="px-4 py-2 text-gray-500 rounded-lg text-sm hover:bg-gray-50">
              {t('cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Tabs + filters + bulk action */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
            {(['upcoming', 'past', 'all'] as Filter[]).map(f => (
              <button key={f} onClick={() => { setFilter(f); setSelected(new Set()) }}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition capitalize ${
                  filter === f ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}>
                {f === 'upcoming' ? t('tabUpcoming') : f === 'past' ? t('tabPast') : t('tabAll')}
              </button>
            ))}
          </div>

          {someSelected && (
            <button
              onClick={() => setShowBulkConfirm(true)}
              disabled={bulkCancelling}
              className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 transition disabled:opacity-50"
            >
              {bulkCancelling ? t('cancelling') : t('cancelCount', { count: selected.size })}
            </button>
          )}
        </div>

        {/* Filter dropdowns */}
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={filterTeacher}
            onChange={e => { setFilterTeacher(e.target.value); setSelected(new Set()) }}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/20"
          >
            <option value="">All teachers</option>
            {uniqueTeachers.map(tc => <option key={tc.id} value={tc.id}>{tc.name}</option>)}
          </select>
          <select
            value={filterRoom}
            onChange={e => { setFilterRoom(e.target.value); setSelected(new Set()) }}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/20"
          >
            <option value="">All rooms</option>
            {uniqueRooms.map(r => <option key={r.id} value={r.id}>{r.location} · {r.name}</option>)}
          </select>
          <select
            value={filterStartHour}
            onChange={e => { setFilterStartHour(e.target.value); setSelected(new Set()) }}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/20"
          >
            <option value="">All times</option>
            {uniqueStartHours.map(h => <option key={h} value={h}>{h}</option>)}
          </select>
          {hasActiveFilters && (
            <button
              onClick={() => { setFilterTeacher(''); setFilterRoom(''); setFilterStartHour(''); setSelected(new Set()) }}
              className="px-2 py-1.5 text-xs text-gray-400 hover:text-gray-600 transition"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Class list */}
      {filteredClasses.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-6 text-sm text-gray-400">
          {t('noClasses')}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
          <div className="px-5 py-2.5 flex items-center gap-3 bg-gray-50">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              className="w-4 h-4 rounded border-gray-300 text-[#6B1F3A] focus:ring-[#6B1F3A]/20 cursor-pointer"
            />
            <span className="text-xs text-gray-500">
              {someSelected ? t('selectedCount', { count: selected.size }) : t('selectAll')}
            </span>
          </div>

          {filteredClasses.map(cls => (
            <div key={cls.id} className={`px-5 py-3.5 flex items-center gap-4 ${selected.has(cls.id) ? 'bg-red-50/40' : ''}`}>
              <input
                type="checkbox"
                checked={selected.has(cls.id)}
                onChange={() => toggleSelect(cls.id)}
                className="w-4 h-4 rounded border-gray-300 text-[#6B1F3A] focus:ring-[#6B1F3A]/20 cursor-pointer shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm font-medium text-gray-900">
                    {new Date(cls.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                  <span className="text-sm text-gray-500">
                    {cls.start_time?.slice(0, 5)} – {cls.end_time?.slice(0, 5)}
                  </span>
                  {cls.teachers?.name && <span className="text-xs text-gray-400">{cls.teachers.name}</span>}
                  {cls.school_rooms && (
                    <span className="text-xs text-gray-400">
                      {cls.school_rooms.school_locations?.name} · {cls.school_rooms.name}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-xs text-gray-400">{t('enrolled', { current: cls.current_bookings, max: cls.max_capacity })}</span>
                  {cls.date < today && <span className="text-xs text-gray-300">{t('tabPast')}</span>}
                </div>
                {(cls.notes || course.notes) && (
                  <div className="mt-1 space-y-0.5">
                    {course.notes && <p className="text-xs text-gray-400">{course.notes}</p>}
                    {cls.notes && <p className="text-xs text-gray-500">{cls.notes}</p>}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Link href={`/school/courses/${id}/classes/${cls.id}`}
                  className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition">
                  {t('edit')}
                </Link>
                {cls.date >= today && (
                  <button
                    onClick={() => handleCancelClass(cls.id)}
                    disabled={cancellingId === cls.id}
                    className="text-xs px-3 py-1.5 rounded-lg border border-red-100 text-red-400 hover:bg-red-50 transition disabled:opacity-50"
                  >
                    {cancellingId === cls.id ? t('cancelling') : t('cancelClass')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Bulk cancel confirmation modal */}
      {showBulkConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <h3 className="font-semibold text-gray-900 text-base">{t('bulkCancelTitle', { count: selected.size })}</h3>
            <p className="text-sm text-gray-500">{t('bulkCancelDesc')}</p>
            <div className="flex gap-2 pt-1">
              <button onClick={handleBulkCancel}
                className="flex-1 px-4 py-2.5 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 transition">
                {t('yesCancelAll')}
              </button>
              <button onClick={() => setShowBulkConfirm(false)}
                className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition">
                {t('goBack')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
