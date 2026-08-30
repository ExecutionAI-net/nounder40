'use client'

import { useEffect, useState, use, useMemo } from 'react'
import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { courseDisplayName, lessonTypeName } from '@/lib/lesson-type-name'
import ScheduleFields, { type ScheduleValue } from '@/components/school/ScheduleFields'
import MultiFilterSelect from '@/components/ui/MultiFilterSelect'
import { apiFetch, ApiError } from '@/lib/api/client'

function errMsg(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof ApiError && typeof err.body === 'object' && err.body) {
    return (err.body as { error?: string }).error ?? fallback
  }
  return fallback
}

interface ClassRow {
  id: string
  date: string
  start_time: string
  end_time: string
  max_capacity: number
  current_bookings: number
  status: string
  notes: string | null
  is_online: boolean | null
  color: string | null
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
  lesson_types: { name_it: string | null; name_en: string | null; name_fr: string | null; name_es: string | null } | null
  teachers: { name: string } | null
}

type Filter = 'upcoming' | 'past' | 'all'

// Returns common value if all equal, else ''
function commonVal<T>(values: T[]): T | '' {
  if (values.length === 0) return ''
  const first = values[0]
  return values.every(v => v === first) ? first : ''
}
function commonBool(values: (boolean | null | undefined)[]): boolean | null {
  const bools = values.map(v => v ?? false)
  const first = bools[0]
  return bools.every(v => v === first) ? first : null
}

export default function CourseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const t = useTranslations('school.courses.detail')
  const tList = useTranslations('school.courses.list')
  const freqLabel: Record<string, string> = {
    single: tList('freqSingle'), weekly: tList('freqWeekly'), biweekly: tList('freqBiweekly'),
  }
  const uiLocale = useLocale()
  const [schoolLang] = useState<string | null>(null)
  // i nomi dei tipi lezione seguono la lingua del profilo scuola
  const locale = schoolLang ?? uiLocale

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
  // Filtri multiselezione + intervallo date
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [filterTeachers, setFilterTeachers] = useState<string[]>([])
  const [filterRooms, setFilterRooms] = useState<string[]>([])
  const [filterStartHours, setFilterStartHours] = useState<string[]>([])
  const [filterDays, setFilterDays] = useState<string[]>([])
  const [filterModes, setFilterModes] = useState<string[]>([])

  // Add class modal
  const [showAddClass, setShowAddClass] = useState(false)
  // ?add=1 (dal bottone 'Aggiungi orario' della pagina di modifica) apre subito il modal
  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('add') === '1') {
      setShowAddClass(true)
    }
  }, [])
  const [addForm, setAddForm] = useState({
    date: '', start_time: '', duration_minutes: '60',
    teacher_id: '', room_id: '', max_capacity: '', credit_cost: '',
    frequency: 'single', end_date: '', compensation_plan_id: '', notes: '',
    language: '',
  })
  const [teachers, setTeachers] = useState<{ id: string; name: string }[]>([])
  const [rooms, setRooms] = useState<{ id: string; name: string; capacity: number; location_name: string }[]>([])
  const [addingClass, setAddingClass] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [plans, setPlans] = useState<{ id: string; name: string }[]>([])

  // Bulk edit state
  const [showBulkEdit, setShowBulkEdit] = useState(false)
  const [bulkEditLoading, setBulkEditLoading] = useState(false)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkSaveError, setBulkSaveError] = useState<string | null>(null)
  const [bulkSaved, setBulkSaved] = useState(false)
  const [bulkForm, setBulkForm] = useState({
    date: '',
    start_time: '',
    duration_minutes: '',
    teacher_id: '',
    room_id: '',
    max_capacity: '',
    credit_cost: '',
    compensation_plan_id: '',
    notes: '',
    is_online: null as boolean | null,
    online_link: '',
  })

  useEffect(() => {
    loadAll()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function loadAll() {
    setLoading(true)

    type LessonFlat = {
      id: string; date: string; start_time: string; end_time: string
      max_capacity: number; current_bookings: number; status: string
      notes: string | null; is_online: boolean | null; color: string | null
      teacher: string | null; room: string | null
    }
    type LocationRow = { id: string; name: string; rooms: { id: string; name: string; capacity: number }[] }
    type TeachersResponse = { teachers: { teachers: { id: string; name: string; active: boolean } | null }[] }

    const [courseData, lessonsRaw, teachersData, locData, plansData] = await Promise.all([
      apiFetch<Course>(`/school/courses/${id}/full/`),
      apiFetch<LessonFlat[]>(`/school/lessons/?course=${id}`),
      apiFetch<TeachersResponse>('/school/teachers/'),
      apiFetch<LocationRow[]>('/school/locations/'),
      apiFetch<{ id: string; name: string }[]>('/school/compensation-plans/'),
    ])

    setCourse(courseData)

    const teacherLinks = teachersData.teachers ?? []
    const teacherNameMap = new Map(teacherLinks.filter(r => r.teachers).map(r => [r.teachers!.id, r.teachers!.name]))
    setTeachers(
      teacherLinks.map(r => r.teachers).filter((x): x is { id: string; name: string; active: boolean } => !!x && x.active)
        .sort((a, b) => a.name.localeCompare(b.name))
    )
    setPlans(Array.isArray(plansData) ? plansData : [])

    const roomMap = new Map<string, { name: string; location: string }>()
    const flatRooms: { id: string; name: string; capacity: number; location_name: string }[] = []
    for (const loc of locData ?? []) {
      for (const room of loc.rooms ?? []) {
        roomMap.set(room.id, { name: room.name, location: loc.name })
        flatRooms.push({ id: room.id, name: room.name, capacity: room.capacity, location_name: loc.name })
      }
    }
    setRooms(flatRooms)

    const classRows: ClassRow[] = lessonsRaw
      .filter(l => l.status !== 'cancelled')
      .map(l => ({
        id: l.id, date: l.date, start_time: l.start_time, end_time: l.end_time,
        max_capacity: l.max_capacity, current_bookings: l.current_bookings, status: l.status,
        notes: l.notes, is_online: l.is_online, color: l.color,
        teachers: l.teacher ? { id: l.teacher, name: teacherNameMap.get(l.teacher) ?? '—' } : null,
        school_rooms: l.room && roomMap.has(l.room)
          ? { id: l.room, name: roomMap.get(l.room)!.name, school_locations: { name: roomMap.get(l.room)!.location } }
          : null,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
    setClasses(classRows)
    setLoading(false)
  }

  // Primo clic arma il bottone, secondo clic chiede conferma con il numero di
  // allieve che verranno rimborsate: e' un'azione sulla lezione intera.
  const [armedId, setArmedId] = useState<string | null>(null)
  async function handleCancelClass(classId: string) {
    if (armedId !== classId) { setArmedId(classId); setTimeout(() => setArmedId(a => (a === classId ? null : a)), 4000); return }
    setArmedId(null)
    const cls = classes.find(c => c.id === classId)
    if (!window.confirm(t('cancelClassConfirm', { count: cls?.current_bookings ?? 0 }))) return
    setCancellingId(classId)
    setError(null)
    try {
      await apiFetch(`/school/classes/${classId}/`, { method: 'DELETE' })
    } catch (err) {
      setError(errMsg(err)); setCancellingId(null); return
    }
    setClasses(prev => prev.filter(c => c.id !== classId))
    setCancellingId(null)
  }

  async function handleBulkCancel() {
    setBulkCancelling(true)
    setShowBulkConfirm(false)
    setError(null)
    for (const classId of selected) {
      await apiFetch(`/school/classes/${classId}/`, { method: 'DELETE' }).catch(() => {})
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
    if (addForm.language) body.language = addForm.language

    try {
      await apiFetch('/school/classes/', { method: 'POST', body: JSON.stringify(body) })
    } catch (err) {
      setAddError(errMsg(err)); setAddingClass(false); return
    }
    setShowAddClass(false)
    setAddForm({ date: '', start_time: '', duration_minutes: '60', teacher_id: '', room_id: '', max_capacity: '', credit_cost: '', frequency: 'single', end_date: '', compensation_plan_id: '', notes: '', language: '' })
    setAddingClass(false)
    loadAll()
  }

  function toggleSelect(classId: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(classId)) next.delete(classId)
      else next.add(classId)
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

  // Open bulk edit: compute mixed values from selected classes
  function openBulkEdit() {
    setBulkSaveError(null)
    setBulkSaved(false)
    setBulkEditLoading(true)
    setShowBulkEdit(true)

    const selectedClasses = classes.filter(c => selected.has(c.id))

    const calcDuration = (cls: ClassRow): string => {
      const [sh, sm] = (cls.start_time ?? '').split(':').map(Number)
      const [eh, em] = (cls.end_time ?? '').split(':').map(Number)
      const dur = (eh * 60 + em) - (sh * 60 + sm)
      return dur > 0 ? String(dur) : '60'
    }

    setBulkForm({
      date: commonVal(selectedClasses.map(c => c.date ?? '')),
      start_time: commonVal(selectedClasses.map(c => c.start_time?.slice(0, 5) ?? '')),
      duration_minutes: commonVal(selectedClasses.map(c => calcDuration(c))),
      teacher_id: commonVal(selectedClasses.map(c => c.teachers?.id ?? '')),
      room_id: commonVal(selectedClasses.map(c => c.school_rooms?.id ?? '')),
      max_capacity: commonVal(selectedClasses.map(c => String(c.max_capacity ?? ''))),
      credit_cost: '',
      compensation_plan_id: '',
      notes: commonVal(selectedClasses.map(c => c.notes ?? '')),
      is_online: commonBool(selectedClasses.map(c => c.is_online)),
      online_link: '',
    })
    setBulkEditLoading(false)
  }

  async function handleBulkSave() {
    setBulkSaving(true)
    setBulkSaveError(null)

    const ids = Array.from(selected)

    // Build partial payload — only send fields that have values
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: Record<string, any> = {}
    if (bulkForm.date) patch.date = bulkForm.date
    if (bulkForm.start_time) patch.start_time = bulkForm.start_time
    if (bulkForm.duration_minutes) patch.duration_minutes = bulkForm.duration_minutes
    if (bulkForm.teacher_id !== '') patch.teacher_id = bulkForm.teacher_id === '__clear__' ? null : (bulkForm.teacher_id || null)
    if (bulkForm.room_id !== '') patch.room_id = bulkForm.room_id === '__clear__' ? null : (bulkForm.room_id || null)
    if (bulkForm.max_capacity) patch.max_capacity = bulkForm.max_capacity
    if (bulkForm.credit_cost) patch.credit_cost = bulkForm.credit_cost
    if (bulkForm.compensation_plan_id !== '') patch.compensation_plan_id = bulkForm.compensation_plan_id === '__clear__' ? null : (bulkForm.compensation_plan_id || null)
    if (bulkForm.notes !== '') patch.notes = bulkForm.notes || null
    if (bulkForm.is_online !== null) patch.is_online = bulkForm.is_online
    if (bulkForm.online_link !== '') patch.online_link = bulkForm.online_link || null

    const results = await Promise.allSettled(ids.map(classId =>
      apiFetch(`/school/classes/${classId}/`, { method: 'PATCH', body: JSON.stringify(patch) })
        .catch(err => { throw new Error(errMsg(err, `Failed for class ${classId}`)) })
    ))

    const failed = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[]
    if (failed.length > 0) {
      setBulkSaveError(failed.map(f => f.reason?.message ?? 'Unknown error').join(', '))
      setBulkSaving(false)
      return
    }

    setBulkSaved(true)
    setBulkSaving(false)
    setShowBulkEdit(false)
    setSelected(new Set())
    loadAll()
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

  const JS_DAYS = useMemo(() => ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'], [])
  const clsWeekday = useMemo(() => (c: ClassRow) => JS_DAYS[new Date(c.date + 'T12:00:00').getDay()], [JS_DAYS])

  const uniqueDays = useMemo(() => {
    const order = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']
    const set = new Set<string>()
    for (const c of classes) set.add(clsWeekday(c))
    return order.filter(d => set.has(d))
  }, [classes, clsWeekday])

  const filteredClasses = useMemo(() => {
    return classes.filter(c => {
      if (filter === 'upcoming' && c.date < today) return false
      if (filter === 'past' && c.date >= today) return false
      if (filterFrom && c.date < filterFrom) return false
      if (filterTo && c.date > filterTo) return false
      if (filterTeachers.length && !filterTeachers.includes(c.teachers?.id ?? '')) return false
      if (filterRooms.length && !filterRooms.includes(c.school_rooms?.id ?? '')) return false
      if (filterStartHours.length && !filterStartHours.includes(c.start_time?.slice(0, 5) ?? '')) return false
      if (filterDays.length && !filterDays.includes(clsWeekday(c))) return false
      if (filterModes.length && !filterModes.includes(c.is_online ? 'online' : 'inperson')) return false
      return true
    })
  }, [classes, filter, filterFrom, filterTo, filterTeachers, filterRooms, filterStartHours, filterDays, filterModes, today, clsWeekday])

  const allSelected = filteredClasses.length > 0 && selected.size === filteredClasses.length
  const someSelected = selected.size > 0
  const hasActiveFilters = !!(filterTeachers.length || filterRooms.length || filterStartHours.length || filterDays.length || filterModes.length || filterFrom || filterTo)

  // Close bulk edit when selection goes to 0
  useEffect(() => {
    if (selected.size === 0) setShowBulkEdit(false)
  }, [selected.size])

  const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

  if (loading) return <div className="text-sm text-gray-400">{t('loading')}</div>
  if (!course) return <div className="text-sm text-gray-400">{t('notFound')}</div>

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header — su mobile titolo a riga intera, azioni nella riga sotto */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 rounded-full shrink-0 mt-1" style={{ backgroundColor: course.color }} />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{courseDisplayName(course.name, course.lesson_types, locale)}</h1>
            <p className="text-gray-500 text-sm mt-0.5">
              {lessonTypeName(course.lesson_types, locale) || '—'} · {freqLabel[course.frequency] ?? course.frequency} · {course.start_time?.slice(0, 5)} · {course.duration_minutes}min
              {course.teachers?.name ? ` · ${course.teachers.name}` : ''}
            </p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0 flex-wrap">
          <button onClick={() => setShowAddClass(true)}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700 transition">
            {t('addClass')}
          </button>
          <Link href={`/school/courses/${id}/edit?from=detail`}
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
      {bulkSaved && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">Changes saved to all selected classes.</div>}

      {/* Add Class Modal */}
      {showAddClass && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h3 className="font-semibold text-gray-900">{t('addClassTitle')}</h3>
          <ScheduleFields
            mode="lesson"
            value={addForm as unknown as ScheduleValue}
            onChange={(patch) => setAddForm(f => ({ ...f, ...patch }))}
            rooms={rooms}
            teachers={teachers}
            plans={plans}
            showDates
            showFrequency
            showNotes
          />
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

      {/* Tabs + filters + bulk actions */}
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
            <div className="flex items-center gap-2">
              <button
                onClick={openBulkEdit}
                className="flex items-center gap-2 px-4 py-2 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition"
              >
                Edit {selected.size} Class{selected.size > 1 ? 'es' : ''}
              </button>
              <button
                onClick={() => setShowBulkConfirm(true)}
                disabled={bulkCancelling}
                className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 transition disabled:opacity-50"
              >
                {bulkCancelling ? t('cancelling') : t('cancelCount', { count: selected.size })}
              </button>
            </div>
          )}
        </div>

        {/* Filter dropdowns — multiselezione */}
        <div className="flex items-center gap-2 flex-wrap">
          <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none bg-white" title={t('filterFrom')} />
          <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none bg-white" title={t('filterTo')} />
          <MultiFilterSelect label={t('filterAllTeachers')} selected={filterTeachers}
            options={uniqueTeachers.map(tc => ({ value: tc.id, label: tc.name }))}
            onChange={v => { setFilterTeachers(v); setSelected(new Set()) }} />
          <MultiFilterSelect label={t('filterAllDays')} selected={filterDays}
            options={uniqueDays.map(d => ({ value: d, label: t(`day_${d}`) }))}
            onChange={v => { setFilterDays(v); setSelected(new Set()) }} />
          <MultiFilterSelect label={t('filterAllTimes')} selected={filterStartHours}
            options={uniqueStartHours.map(h => ({ value: h, label: h }))}
            onChange={v => { setFilterStartHours(v); setSelected(new Set()) }} />
          <MultiFilterSelect label={t('filterAllRooms')} selected={filterRooms}
            options={uniqueRooms.map(r => ({ value: r.id, label: `${r.location} · ${r.name}` }))}
            onChange={v => { setFilterRooms(v); setSelected(new Set()) }} />
          <MultiFilterSelect label={t('filterMode')} selected={filterModes}
            options={[{ value: 'inperson', label: t('modeInPerson') }, { value: 'online', label: t('modeOnline') }]}
            onChange={v => { setFilterModes(v); setSelected(new Set()) }} />
          {hasActiveFilters && (
            <button
              onClick={() => { setFilterTeachers([]); setFilterRooms([]); setFilterStartHours([]); setFilterDays([]); setFilterModes([]); setFilterFrom(''); setFilterTo(''); setSelected(new Set()) }}
              className="px-2 py-1.5 text-xs text-gray-400 hover:text-gray-600 transition"
            >
              {t('clearFilters')}
            </button>
          )}
        </div>
      </div>

      {/* Bulk Edit Inline Panel */}
      {showBulkEdit && (
        <div className="bg-white rounded-xl border border-[#6B1F3A]/20 p-5 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-semibold text-gray-900 text-sm">Edit {selected.size} Class{selected.size > 1 ? 'es' : ''}</h3>
              <p className="text-xs text-gray-500 mt-1">
                Only the fields you fill in will be updated. Fields left blank will not be changed.
                If selected classes have different values for a field, that field appears empty.
              </p>
            </div>
            <button onClick={() => setShowBulkEdit(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none shrink-0">×</button>
          </div>

          {bulkEditLoading ? (
            <div className="text-sm text-gray-400 py-4 text-center">Loading...</div>
          ) : (
            <div className="space-y-4">
              {/* Notice banner */}
              <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                <strong>{selected.size} classes selected.</strong> Fields you fill in will overwrite the same field in all selected classes. Fields left blank will not be changed.
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{t('labelDate')}</label>
                  <input type="date" value={bulkForm.date} onChange={e => setBulkForm(f => ({ ...f, date: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{t('labelStartTime')}</label>
                  <input type="time" value={bulkForm.start_time} onChange={e => setBulkForm(f => ({ ...f, start_time: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{t('labelDuration')}</label>
                  <input type="number" value={bulkForm.duration_minutes} onChange={e => setBulkForm(f => ({ ...f, duration_minutes: e.target.value }))} placeholder="— unchanged —" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{t('labelMaxCapacity')}</label>
                  <input type="number" value={bulkForm.max_capacity} onChange={e => setBulkForm(f => ({ ...f, max_capacity: e.target.value }))} placeholder="— unchanged —" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{t('labelTeacher')}</label>
                  <select value={bulkForm.teacher_id} onChange={e => setBulkForm(f => ({ ...f, teacher_id: e.target.value }))} className={inputCls}>
                    <option value="">— unchanged —</option>
                    <option value="__clear__">No teacher</option>
                    {teachers.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>{t('labelRoom')}</label>
                  <select value={bulkForm.room_id} onChange={e => setBulkForm(f => ({ ...f, room_id: e.target.value }))} className={inputCls}>
                    <option value="">— unchanged —</option>
                    <option value="__clear__">No room</option>
                    {rooms.map(r => <option key={r.id} value={r.id}>{r.location_name} — {r.name} ({t('cap')} {r.capacity})</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>{t('labelCredits')}</label>
                  <input type="number" value={bulkForm.credit_cost} onChange={e => setBulkForm(f => ({ ...f, credit_cost: e.target.value }))} placeholder="— unchanged —" className={inputCls} />
                </div>
                {plans.length > 0 && (
                  <div>
                    <label className={labelCls}>{t('labelCompPlan')}</label>
                    <select value={bulkForm.compensation_plan_id} onChange={e => setBulkForm(f => ({ ...f, compensation_plan_id: e.target.value }))} className={inputCls}>
                      <option value="">— unchanged —</option>
                      <option value="__clear__">No plan</option>
                      {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                )}
                <div className="col-span-2">
                  <label className={labelCls}>{t('labelNotes')}</label>
                  <textarea value={bulkForm.notes} onChange={e => setBulkForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="— unchanged —" className={`${inputCls} resize-none`} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Online / In-Person</label>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setBulkForm(f => ({ ...f, is_online: null }))}
                      className={`px-3 py-1.5 rounded-lg text-xs border transition ${bulkForm.is_online === null ? 'bg-gray-200 font-medium border-gray-400' : 'border-gray-200 text-gray-400'}`}>
                      Unchanged
                    </button>
                    <button type="button" onClick={() => setBulkForm(f => ({ ...f, is_online: false }))}
                      className={`px-3 py-1.5 rounded-lg text-xs border transition ${bulkForm.is_online === false ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600'}`}>
                      📍 In-Person
                    </button>
                    <button type="button" onClick={() => setBulkForm(f => ({ ...f, is_online: true }))}
                      className={`px-3 py-1.5 rounded-lg text-xs border transition ${bulkForm.is_online === true ? 'bg-[#6B1F3A] text-white border-[#6B1F3A]' : 'border-gray-200 text-gray-600'}`}>
                      🌐 Online
                    </button>
                  </div>
                  {bulkForm.is_online === true && (
                    <input type="url" value={bulkForm.online_link} onChange={e => setBulkForm(f => ({ ...f, online_link: e.target.value }))} placeholder="https://zoom.us/j/..." className={`${inputCls} mt-2`} />
                  )}
                </div>
              </div>

              {bulkSaveError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{bulkSaveError}</div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleBulkSave}
                  disabled={bulkSaving}
                  className="px-5 py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
                >
                  {bulkSaving ? 'Saving...' : `Save Changes to ${selected.size} Class${selected.size > 1 ? 'es' : ''}`}
                </button>
                <button onClick={() => setShowBulkEdit(false)} className="px-5 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

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
            <div key={cls.id} className={`px-5 py-3.5 flex items-center gap-4 ${selected.has(cls.id) ? 'bg-[#6B1F3A]/5' : ''}`}>
              <input
                type="checkbox"
                checked={selected.has(cls.id)}
                onChange={() => toggleSelect(cls.id)}
                className="w-4 h-4 rounded border-gray-300 text-[#6B1F3A] focus:ring-[#6B1F3A]/20 cursor-pointer shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  {/* colore del singolo orario (fallback: colore corso) */}
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cls.color ?? course.color }} />
                  <span className="text-sm font-medium text-gray-900">
                    {new Date(cls.date + 'T12:00:00').toLocaleDateString(uiLocale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
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
                    className={`text-xs px-3 py-1.5 rounded-lg transition disabled:opacity-50 ${armedId === cls.id ? 'bg-red-600 text-white hover:bg-red-700' : 'border border-red-100 text-red-400 hover:bg-red-50'}`}
                  >
                    {cancellingId === cls.id ? t('cancelling') : armedId === cls.id ? t('cancelArmed') : t('cancelClass')}
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
