'use client'

import Link from 'next/link'
import { useState, useMemo, useEffect, useRef } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { courseDisplayName, lessonTypeName } from '@/lib/lesson-type-name'
import ConfirmDeleteButton from '@/components/ui/ConfirmDeleteButton'
import ColorPicker from '@/components/ui/ColorPicker'
import MultiFilterSelect from '@/components/ui/MultiFilterSelect'
import { apiFetch, ApiError } from '@/lib/api/client'

export interface ScheduleSummary {
  weekday: string
  start_time: string
  duration_minutes: number
  class_count: number
  first_date: string
  last_date: string
  teacher_id: string | null
  teacher_name: string | null
  location_name: string | null
  room_name: string | null
  max_capacity: number | null
  is_online: boolean | null
  color: string | null
}

export interface Course {
  id: string
  name: string
  color: string
  frequency: string
  start_time: string
  duration_minutes: number
  start_date: string
  end_date: string | null
  active: boolean
  notes: string | null
  lesson_types: { name_en: string; name_it: string; name_es?: string | null } | null
  teachers: { name: string } | null
  _schedules: ScheduleSummary[]
}

interface CourseDetail {
  id: string
  lesson_type_id: string
  teacher_id: string | null
  name: string
  description: string | null
  notes: string | null
  is_online: boolean
  online_link: string | null
  start_time: string
  duration_minutes: number
  max_capacity: number
  reserve_spots: number
  credit_cost: number
  color: string
  vip_booking_hours_before: number
  min_booking_notice_hours: number
  waitlist_enabled: boolean
}

type LessonType = { id: string; name_en: string; name_it: string; name_es?: string | null }
type Teacher = { id: string; name: string }

function errMsg(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof ApiError && typeof err.body === 'object' && err.body) {
    return (err.body as { error?: string }).error ?? fallback
  }
  return fallback
}

// Returns the common value if all are equal, else ''
function commonValue<T>(values: T[]): T | '' {
  if (values.length === 0) return ''
  const first = values[0]
  return values.every(v => v === first) ? first : ''
}

// Returns the common boolean if all are equal, else null (indeterminate)
function commonBool(values: boolean[]): boolean | null {
  if (values.length === 0) return null
  const first = values[0]
  return values.every(v => v === first) ? first : null
}


function fmtDate(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export default function CoursesClient({
  initialCourses,
  initialLessonTypes = [],
  initialTeachers = [],
  schoolLang,
}: {
  initialCourses: Course[]
  initialLessonTypes?: LessonType[]
  initialTeachers?: Teacher[]
  schoolLang?: string
}) {
  const t = useTranslations('school.courses.list')
  const uiLocale = useLocale()
  // i nomi dei tipi lezione seguono la lingua del profilo scuola
  const locale = schoolLang ?? uiLocale

  const WEEKDAY_LABELS: Record<string, string> = {
    monday: t('dayMonday'), tuesday: t('dayTuesday'), wednesday: t('dayWednesday'),
    thursday: t('dayThursday'), friday: t('dayFriday'), saturday: t('daySaturday'), sunday: t('daySunday'),
  }
  const freqLabel: Record<string, string> = {
    single: t('freqSingle'), weekly: t('freqWeekly'), biweekly: t('freqBiweekly'),
  }

  const [courses, setCourses] = useState<Course[]>(initialCourses)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [showBulkConfirm, setShowBulkConfirm] = useState(false)

  // Filtri multiselezione (insegnante, giorno, orario, sede, aula, online/in presenza)
  const [filterTeachers, setFilterTeachers] = useState<string[]>([])
  const [filterDays, setFilterDays] = useState<string[]>([])
  const [filterHours, setFilterHours] = useState<string[]>([])
  const [filterLocations, setFilterLocations] = useState<string[]>([])
  const [filterRooms, setFilterRooms] = useState<string[]>([])
  const [filterModes, setFilterModes] = useState<string[]>([])

  // Bulk edit state
  const [showBulkEdit, setShowBulkEdit] = useState(false)
  const [bulkEditLoading, setBulkEditLoading] = useState(false)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkSaveError, setBulkSaveError] = useState<string | null>(null)
  const [bulkSaved, setBulkSaved] = useState(false)

  // Reference data (passed from server)
  const lessonTypes = initialLessonTypes
  const teachers = initialTeachers

  // Bulk edit form — '' means "not set / keep unchanged"
  const [bulkForm, setBulkForm] = useState({
    lesson_type_id: '',
    teacher_id: '',
    name: '',
    description: '',
    notes: '',
    is_online: null as boolean | null,   // null = mixed/unchanged
    online_link: '',
    start_time: '',
    duration_minutes: '',
    max_capacity: '',
    reserve_spots: '',
    credit_cost: '',
    color: '',
    vip_booking_hours_before: '',
    min_booking_notice_hours: '',
    waitlist_enabled: null as boolean | null,
    update_future_lessons: true,
  })

  // insegnante effettivo di una riga orario (override o default del corso)
  const schedTeacher = (c: Course, sc: ScheduleSummary) => sc.teacher_name ?? c.teachers?.name ?? null

  const uniqueTeachers = useMemo(() => {
    const set = new Set<string>()
    for (const c of courses) for (const sc of c._schedules) {
      const n = schedTeacher(c, sc)
      if (n) set.add(n)
    }
    return Array.from(set).sort()
  }, [courses])

  const uniqueDays = useMemo(() => {
    const order = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    const set = new Set<string>()
    for (const c of courses) for (const sc of c._schedules) set.add(sc.weekday)
    return order.filter(d => set.has(d))
  }, [courses])

  const uniqueLocations = useMemo(() => {
    const set = new Set<string>()
    for (const c of courses) for (const sc of c._schedules) {
      if (sc.location_name) set.add(sc.location_name)
    }
    return Array.from(set).sort()
  }, [courses])

  const uniqueRooms = useMemo(() => {
    const set = new Set<string>()
    for (const c of courses) for (const sc of c._schedules) {
      if (sc.room_name) set.add(sc.room_name)
    }
    return Array.from(set).sort()
  }, [courses])

  const uniqueStartHours = useMemo(() => {
    const set = new Set<string>()
    for (const c of courses) for (const sc of c._schedules) {
      if (sc.start_time) set.add(sc.start_time)
    }
    return Array.from(set).sort()
  }, [courses])

  // una riga orario soddisfa TUTTI i filtri attivi; il corso passa se almeno
  // una delle sue righe soddisfa
  const schedMatches = (c: Course, sc: ScheduleSummary) => {
    if (filterTeachers.length && !filterTeachers.includes(schedTeacher(c, sc) ?? '')) return false
    if (filterDays.length && !filterDays.includes(sc.weekday)) return false
    if (filterHours.length && !filterHours.includes(sc.start_time)) return false
    if (filterLocations.length && !filterLocations.includes(sc.location_name ?? '')) return false
    if (filterRooms.length && !filterRooms.includes(sc.room_name ?? '')) return false
    if (filterModes.length && !filterModes.includes(sc.is_online ? 'online' : 'inperson')) return false
    return true
  }

  const hasActiveFilters = !!(filterTeachers.length || filterDays.length || filterHours.length || filterLocations.length || filterRooms.length || filterModes.length)

  const filteredCourses = useMemo(() => {
    return courses.filter(c => c._schedules.some(sc => schedMatches(c, sc)) || (c._schedules.length === 0 && !hasActiveFilters))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courses, filterTeachers, filterDays, filterHours, filterLocations, filterRooms, filterModes])

  // Open bulk edit: fetch all selected course details, compute mixed values
  async function openBulkEdit() {
    setBulkEditLoading(true)
    setBulkSaveError(null)
    setBulkSaved(false)
    setShowBulkEdit(true)

    const ids = Array.from(selected)
    const details: CourseDetail[] = []
    await Promise.all(ids.map(async id => {
      try { details.push(await apiFetch<CourseDetail>(`/school/courses/${id}/full/`)) } catch { /* skip */ }
    }))

    setBulkForm({
      lesson_type_id: commonValue(details.map(d => d.lesson_type_id ?? '')),
      teacher_id: commonValue(details.map(d => d.teacher_id ?? '')),
      name: commonValue(details.map(d => d.name ?? '')),
      description: commonValue(details.map(d => d.description ?? '')),
      notes: commonValue(details.map(d => d.notes ?? '')),
      is_online: commonBool(details.map(d => d.is_online ?? false)),
      online_link: commonValue(details.map(d => d.online_link ?? '')),
      start_time: commonValue(details.map(d => d.start_time?.slice(0, 5) ?? '')),
      duration_minutes: commonValue(details.map(d => String(d.duration_minutes ?? ''))),
      max_capacity: commonValue(details.map(d => String(d.max_capacity ?? ''))),
      reserve_spots: commonValue(details.map(d => String(d.reserve_spots ?? ''))),
      credit_cost: commonValue(details.map(d => String(d.credit_cost ?? ''))),
      color: commonValue(details.map(d => d.color ?? '')),
      vip_booking_hours_before: commonValue(details.map(d => String(d.vip_booking_hours_before ?? ''))),
      min_booking_notice_hours: commonValue(details.map(d => String(d.min_booking_notice_hours ?? ''))),
      waitlist_enabled: commonBool(details.map(d => d.waitlist_enabled ?? false)),
      update_future_lessons: true,
    })
    setBulkEditLoading(false)
  }

  async function handleBulkSave() {
    setBulkSaving(true)
    setBulkSaveError(null)
    const ids = Array.from(selected)

    // Build partial payload — only include fields the user actually filled in
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: Record<string, any> = {}
    if (bulkForm.lesson_type_id) patch.lesson_type_id = bulkForm.lesson_type_id
    if (bulkForm.teacher_id !== '') patch.teacher_id = bulkForm.teacher_id === '__clear__' ? null : (bulkForm.teacher_id || null)
    if (bulkForm.name) patch.name = bulkForm.name
    if (bulkForm.description !== '') patch.description = bulkForm.description || null
    if (bulkForm.notes !== '') patch.notes = bulkForm.notes || null
    if (bulkForm.is_online !== null) patch.is_online = bulkForm.is_online
    if (bulkForm.online_link !== '') patch.online_link = bulkForm.online_link || null
    if (bulkForm.start_time) patch.start_time = bulkForm.start_time
    if (bulkForm.duration_minutes) patch.duration_minutes = Number(bulkForm.duration_minutes)
    if (bulkForm.max_capacity) patch.max_capacity = Number(bulkForm.max_capacity)
    if (bulkForm.reserve_spots) patch.reserve_spots = Number(bulkForm.reserve_spots)
    if (bulkForm.credit_cost) patch.credit_cost = Number(bulkForm.credit_cost)
    if (bulkForm.color) patch.color = bulkForm.color
    if (bulkForm.vip_booking_hours_before) patch.vip_booking_hours_before = Number(bulkForm.vip_booking_hours_before)
    if (bulkForm.min_booking_notice_hours) patch.min_booking_notice_hours = Number(bulkForm.min_booking_notice_hours)
    if (bulkForm.waitlist_enabled !== null) patch.waitlist_enabled = bulkForm.waitlist_enabled

    // lesson_type_id and name are required by the API — if not set, fetch from each course
    const results = await Promise.allSettled(ids.map(async id => {
      const course = courses.find(c => c.id === id)
      const body = {
        ...patch,
        // Ensure required fields are present
        lesson_type_id: patch.lesson_type_id ?? undefined,
        name: patch.name ?? undefined,
        update_future_lessons: bulkForm.update_future_lessons,
      }
      // If required fields are missing, we need to get them from the existing course data
      // We'll make a GET first if needed
      if (!body.lesson_type_id) {
        const existing = await apiFetch<CourseDetail>(`/school/courses/${id}/full/`)
        body.lesson_type_id = body.lesson_type_id ?? existing.lesson_type_id
        body.name = body.name ?? existing.name
      }
      try {
        await apiFetch(`/school/courses/${id}/full/`, { method: 'PUT', body: JSON.stringify(body) })
      } catch (err) {
        throw new Error(errMsg(err, `Failed for course ${course?.name ?? id}`))
      }
    }))

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
    // Refresh page to show updated data
    window.location.reload()
  }

  // Primo click: conta lezioni/prenotazioni collegate
  async function armDeleteCourse(courseId: string): Promise<string | null> {
    setError(null)
    let d: CourseDetail & { _linked?: { lessons: number; bookings: number } }
    try {
      d = await apiFetch(`/school/courses/${courseId}/full/`)
    } catch {
      setError(t('errorGeneric')); return null
    }
    const linked = d._linked ?? { lessons: 0, bookings: 0 }
    const parts = [
      linked.lessons > 0 && t('linkedLessons', { count: linked.lessons }),
      linked.bookings > 0 && t('linkedBookings', { count: linked.bookings }),
    ].filter(Boolean)
    return parts.length
      ? t('deleteArmedLinked', { linked: parts.join(', ') })
      : t('deleteArmedClean')
  }

  async function handleDelete(courseId: string) {
    setError(null)
    try {
      await apiFetch(`/school/courses/${courseId}/full/`, { method: 'DELETE' })
    } catch (err) {
      setError(errMsg(err, t('errorGeneric')))
      return
    }
    setCourses(prev => prev.filter(c => c.id !== courseId))
  }

  async function handleBulkDelete() {
    setBulkDeleting(true)
    setShowBulkConfirm(false)
    setError(null)
    for (const courseId of selected) {
      await apiFetch(`/school/courses/${courseId}/full/`, { method: 'DELETE' }).catch(() => {})
    }
    setCourses(prev => prev.filter(c => !selected.has(c.id)))
    setSelected(new Set())
    setBulkDeleting(false)
  }

  // Sposta un corso su/giù: movimento immediato, salvataggio ~2s dopo
  // l'ULTIMO movimento (debounce: niente una chiamata per ogni click)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingIds = useRef<string[] | null>(null)

  async function persistOrder(ids: string[]) {
    pendingIds.current = null
    try {
      await apiFetch('/school/courses-reorder/', { method: 'POST', body: JSON.stringify({ ids }) })
    } catch (err) {
      setError(errMsg(err, t('errorGeneric')))
    }
  }

  // se si lascia la pagina con un salvataggio in sospeso, salva subito
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    if (pendingIds.current) void persistOrder(pendingIds.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function moveCourse(courseId: string, dir: -1 | 1) {
    const idx = courses.findIndex(c => c.id === courseId)
    const target = idx + dir
    if (idx < 0 || target < 0 || target >= courses.length) return
    const next = [...courses]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    setCourses(next)
    const ids = next.map(c => c.id)
    pendingIds.current = ids
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => persistOrder(ids), 2000)
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selected.size === filteredCourses.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filteredCourses.map(c => c.id)))
    }
  }

  // Close bulk edit when selection changes to 0
  useEffect(() => {
    if (selected.size === 0) setShowBulkEdit(false)
  }, [selected.size])

  const inputCls = 'w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
          <p className="text-gray-500 text-sm mt-1">{t('subtitle')}</p>
        </div>
        <Link
          href="/school/courses/new"
          className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700 transition"
        >
          + {t('newCourse')}
        </Link>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
      )}

      {/* Filters — tutti a multiselezione */}
      <div className="flex items-center gap-2 flex-wrap">
        <MultiFilterSelect label={t('filterAllTeachers')} selected={filterTeachers}
          options={uniqueTeachers.map(n => ({ value: n, label: n }))}
          onChange={v => { setFilterTeachers(v); setSelected(new Set()) }} />
        <MultiFilterSelect label={t('filterAllDays')} selected={filterDays}
          options={uniqueDays.map(d => ({ value: d, label: WEEKDAY_LABELS[d] ?? d }))}
          onChange={v => { setFilterDays(v); setSelected(new Set()) }} />
        <MultiFilterSelect label={t('filterAllTimes')} selected={filterHours}
          options={uniqueStartHours.map(h => ({ value: h, label: h }))}
          onChange={v => { setFilterHours(v); setSelected(new Set()) }} />
        <MultiFilterSelect label={t('filterAllLocations')} selected={filterLocations}
          options={uniqueLocations.map(l => ({ value: l, label: l }))}
          onChange={v => { setFilterLocations(v); setSelected(new Set()) }} />
        <MultiFilterSelect label={t('filterAllRooms')} selected={filterRooms}
          options={uniqueRooms.map(r => ({ value: r, label: r }))}
          onChange={v => { setFilterRooms(v); setSelected(new Set()) }} />
        <MultiFilterSelect label={t('filterMode')} selected={filterModes}
          options={[{ value: 'inperson', label: t('modeInPerson') }, { value: 'online', label: t('modeOnline') }]}
          onChange={v => { setFilterModes(v); setSelected(new Set()) }} />
        {hasActiveFilters && (
          <button
            onClick={() => { setFilterTeachers([]); setFilterDays([]); setFilterHours([]); setFilterLocations([]); setFilterRooms([]); setFilterModes([]); setSelected(new Set()) }}
            className="px-2 py-1.5 text-xs text-gray-400 hover:text-gray-600 transition"
          >
            {t('clearFilters')}
          </button>
        )}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg flex-wrap">
          <span className="text-sm text-gray-700 font-medium">{selected.size} course{selected.size > 1 ? 's' : ''} selected</span>
          <button
            onClick={openBulkEdit}
            className="px-4 py-1.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition"
          >
            {t('editSelected')}
          </button>
          <button
            onClick={() => setShowBulkConfirm(true)}
            disabled={bulkDeleting}
            className="px-4 py-1.5 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 transition disabled:opacity-50"
          >
            {bulkDeleting ? t('deleting') : t('deleteSelected')}
          </button>
          <button onClick={() => setSelected(new Set())} className="text-sm text-gray-400 hover:text-gray-600">
            Clear selection
          </button>
        </div>
      )}

      {/* Bulk Edit Inline Panel */}
      {showBulkEdit && (
        <div className="bg-white rounded-xl border border-[#6B1F3A]/20 p-5 space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-semibold text-gray-900 text-sm">Edit {selected.size} Course{selected.size > 1 ? 's' : ''}</h3>
              <p className="text-xs text-gray-500 mt-1">
                Only the fields you fill in will be updated. Fields left blank will not be changed.
                If selected courses have different values for a field, that field appears empty.
              </p>
            </div>
            <button onClick={() => setShowBulkEdit(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none shrink-0">×</button>
          </div>

          {bulkEditLoading ? (
            <div className="text-sm text-gray-400 py-4 text-center">Loading course details...</div>
          ) : (
            <div className="space-y-5">
              {/* Notice banner */}
              <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                <strong>{selected.size} courses selected.</strong> Fields you fill in will overwrite the same field in all selected courses. Fields left blank will not be changed.
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Lesson Type */}
                <div>
                  <label className={labelCls}>Lesson Type</label>
                  <select value={bulkForm.lesson_type_id} onChange={e => setBulkForm(f => ({ ...f, lesson_type_id: e.target.value }))} className={inputCls}>
                    <option value="">— unchanged —</option>
                    {lessonTypes.map(lt => <option key={lt.id} value={lt.id}>{lessonTypeName(lt, locale) || lt.name_en}</option>)}
                  </select>
                </div>

                {/* Default Teacher */}
                <div>
                  <label className={labelCls}>Default Teacher</label>
                  <select value={bulkForm.teacher_id} onChange={e => setBulkForm(f => ({ ...f, teacher_id: e.target.value }))} className={inputCls}>
                    <option value="">— unchanged —</option>
                    <option value="__clear__">No teacher</option>
                    {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>

                {/* Start Time */}
                <div>
                  <label className={labelCls}>Start Time</label>
                  <input type="time" value={bulkForm.start_time} onChange={e => setBulkForm(f => ({ ...f, start_time: e.target.value }))} className={inputCls} />
                </div>

                {/* Duration */}
                <div>
                  <label className={labelCls}>Duration (min)</label>
                  <input type="number" min="15" step="15" value={bulkForm.duration_minutes} onChange={e => setBulkForm(f => ({ ...f, duration_minutes: e.target.value }))} placeholder="— unchanged —" className={inputCls} />
                </div>

                {/* Max Capacity */}
                <div>
                  <label className={labelCls}>Max Capacity</label>
                  <input type="number" min="1" value={bulkForm.max_capacity} onChange={e => setBulkForm(f => ({ ...f, max_capacity: e.target.value }))} placeholder="— unchanged —" className={inputCls} />
                </div>

                {/* Reserve Spots */}
                <div>
                  <label className={labelCls}>Reserve Spots</label>
                  <input type="number" min="0" value={bulkForm.reserve_spots} onChange={e => setBulkForm(f => ({ ...f, reserve_spots: e.target.value }))} placeholder="— unchanged —" className={inputCls} />
                </div>

                {/* Credit Cost */}
                <div>
                  <label className={labelCls}>{t('creditCost')}</label>
                  <input type="number" min="1" value={bulkForm.credit_cost} onChange={e => setBulkForm(f => ({ ...f, credit_cost: e.target.value }))} placeholder="— unchanged —" className={inputCls} />
                </div>

                {/* VIP Booking Hours */}
                <div>
                  <label className={labelCls}>VIP Booking Hours Before</label>
                  <input type="number" min="0" value={bulkForm.vip_booking_hours_before} onChange={e => setBulkForm(f => ({ ...f, vip_booking_hours_before: e.target.value }))} placeholder="— unchanged —" className={inputCls} />
                </div>

                {/* Min Booking Notice */}
                <div>
                  <label className={labelCls}>Min Booking Notice (hours)</label>
                  <input type="number" min="0" value={bulkForm.min_booking_notice_hours} onChange={e => setBulkForm(f => ({ ...f, min_booking_notice_hours: e.target.value }))} placeholder="— unchanged —" className={inputCls} />
                </div>
              </div>

              {/* Color */}
              <div>
                <label className={labelCls}>Calendar Color</label>
                <div className="flex gap-2 mt-1 flex-wrap items-center">
                  <button
                    type="button"
                    onClick={() => setBulkForm(f => ({ ...f, color: '' }))}
                    className={`px-3 py-1 rounded-full text-xs border transition ${!bulkForm.color ? 'border-gray-900 bg-gray-100 font-medium' : 'border-gray-200 text-gray-400'}`}
                  >
                    unchanged
                  </button>
                  <ColorPicker value={bulkForm.color} onChange={(c) => setBulkForm(f => ({ ...f, color: c }))} />
                </div>
              </div>

              {/* Name */}
              <div>
                <label className={labelCls}>Course Name</label>
                <input type="text" value={bulkForm.name} onChange={e => setBulkForm(f => ({ ...f, name: e.target.value }))} placeholder="— unchanged —" className={inputCls} />
              </div>

              {/* Description */}
              <div>
                <label className={labelCls}>Description</label>
                <textarea value={bulkForm.description} onChange={e => setBulkForm(f => ({ ...f, description: e.target.value }))} rows={2} placeholder="— unchanged —" className={`${inputCls} resize-none`} />
              </div>

              {/* Notes */}
              <div>
                <label className={labelCls}>Notes</label>
                <textarea value={bulkForm.notes} onChange={e => setBulkForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="— unchanged —" className={`${inputCls} resize-none`} />
              </div>

              {/* Online */}
              <div>
                <label className={labelCls}>Online / In-Person</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setBulkForm(f => ({ ...f, is_online: null }))}
                    className={`px-3 py-1.5 rounded-lg text-xs border transition ${bulkForm.is_online === null ? 'bg-gray-200 font-medium border-gray-400' : 'border-gray-200 text-gray-400'}`}
                  >
                    Unchanged
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkForm(f => ({ ...f, is_online: false }))}
                    className={`px-3 py-1.5 rounded-lg text-xs border transition ${bulkForm.is_online === false ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600'}`}
                  >
                    📍 In-Person
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkForm(f => ({ ...f, is_online: true }))}
                    className={`px-3 py-1.5 rounded-lg text-xs border transition ${bulkForm.is_online === true ? 'bg-[#6B1F3A] text-white border-[#6B1F3A]' : 'border-gray-200 text-gray-600'}`}
                  >
                    🌐 Online
                  </button>
                </div>
                {bulkForm.is_online === true && (
                  <input type="url" value={bulkForm.online_link} onChange={e => setBulkForm(f => ({ ...f, online_link: e.target.value }))} placeholder="https://zoom.us/j/..." className={`${inputCls} mt-2`} />
                )}
              </div>

              {/* Waitlist */}
              <div>
                <label className={labelCls}>Waitlist</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setBulkForm(f => ({ ...f, waitlist_enabled: null }))}
                    className={`px-3 py-1.5 rounded-lg text-xs border transition ${bulkForm.waitlist_enabled === null ? 'bg-gray-200 font-medium border-gray-400' : 'border-gray-200 text-gray-400'}`}>
                    Unchanged
                  </button>
                  <button type="button" onClick={() => setBulkForm(f => ({ ...f, waitlist_enabled: false }))}
                    className={`px-3 py-1.5 rounded-lg text-xs border transition ${bulkForm.waitlist_enabled === false ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600'}`}>
                    Disabled
                  </button>
                  <button type="button" onClick={() => setBulkForm(f => ({ ...f, waitlist_enabled: true }))}
                    className={`px-3 py-1.5 rounded-lg text-xs border transition ${bulkForm.waitlist_enabled === true ? 'bg-[#6B1F3A] text-white border-[#6B1F3A]' : 'border-gray-200 text-gray-600'}`}>
                    Enabled
                  </button>
                </div>
              </div>

              {/* Update future lessons toggle */}
              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative shrink-0">
                  <input type="checkbox" className="sr-only" checked={bulkForm.update_future_lessons} onChange={e => setBulkForm(f => ({ ...f, update_future_lessons: e.target.checked }))} />
                  <div className={`w-10 h-6 rounded-full transition ${bulkForm.update_future_lessons ? 'bg-[#6B1F3A]' : 'bg-gray-200'}`} />
                  <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${bulkForm.update_future_lessons ? 'left-5' : 'left-1'}`} />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700">Apply changes to future classes too</p>
                  <p className="text-xs text-gray-400">{t('bulkUpdateHint')}</p>
                </div>
              </label>

              {bulkSaveError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{bulkSaveError}</div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleBulkSave}
                  disabled={bulkSaving}
                  className="px-5 py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
                >
                  {bulkSaving ? 'Saving...' : `Save Changes to ${selected.size} Course${selected.size > 1 ? 's' : ''}`}
                </button>
                <button onClick={() => setShowBulkEdit(false)} className="px-5 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {bulkSaved && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
          Changes saved successfully to all selected courses.
        </div>
      )}

      {filteredCourses.length === 0 && courses.length > 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-6 text-sm text-gray-400">
          No courses match the selected filters.
        </div>
      ) : courses.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
          <p className="text-gray-400 text-sm">No courses yet.</p>
          <Link href="/school/courses/new" className="mt-3 inline-block text-sm text-gray-900 font-medium underline">
            Create your first course
          </Link>
        </div>
      ) : filteredCourses.length === 0 ? null : (
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
          <div className="px-5 py-2.5 flex items-center gap-3 bg-gray-50">
            <input
              type="checkbox"
              checked={selected.size === filteredCourses.length && filteredCourses.length > 0}
              onChange={toggleSelectAll}
              className="w-4 h-4 rounded border-gray-300 cursor-pointer"
            />
            <span className="text-xs text-gray-500">
              {selected.size > 0 ? t('selectedCount', { count: selected.size }) : t('selectAll')}
            </span>
          </div>

          {filteredCourses.map(course => {
            const totalClasses = course._schedules.reduce((s, sc) => s + sc.class_count, 0)
            const actionButtons = (
              <>
                {/* frecce ordinamento: attive solo senza filtri (l'ordine è quello reale) */}
                {!hasActiveFilters && (
                  <div className="flex flex-col mr-1">
                    <button
                      onClick={() => moveCourse(course.id, -1)}
                      disabled={courses.findIndex(c => c.id === course.id) === 0}
                      className="text-gray-300 hover:text-gray-700 disabled:opacity-30 disabled:hover:text-gray-300 leading-none px-1 transition"
                      title={t('moveUp')}
                    >▲</button>
                    <button
                      onClick={() => moveCourse(course.id, 1)}
                      disabled={courses.findIndex(c => c.id === course.id) === courses.length - 1}
                      className="text-gray-300 hover:text-gray-700 disabled:opacity-30 disabled:hover:text-gray-300 leading-none px-1 transition"
                      title={t('moveDown')}
                    >▼</button>
                  </div>
                )}
                <Link
                  href={`/school/courses/${course.id}`}
                  className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition"
                >
                  {t('viewClasses')}
                </Link>
                <Link
                  href={`/school/courses/${course.id}/edit`}
                  className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition"
                >
                  {t('edit')}
                </Link>
                <ConfirmDeleteButton
                  label={t('delete')}
                  armedLabel={t('deleteArmedClean')}
                  onArm={() => armDeleteCourse(course.id)}
                  onDelete={() => handleDelete(course.id)}
                  className="border border-red-100 text-red-400 hover:bg-red-50"
                />
              </>
            )
            return (
              // Su mobile le azioni stanno sotto il conteggio lezioni, prima degli orari
              <div key={course.id} className={`px-5 py-4 flex items-start gap-3 sm:gap-4 ${selected.has(course.id) ? 'bg-[#6B1F3A]/5' : ''}`}>
                <input
                  type="checkbox"
                  checked={selected.has(course.id)}
                  onChange={() => toggleSelect(course.id)}
                  className="w-4 h-4 rounded border-gray-300 cursor-pointer shrink-0 mt-1"
                />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900">{courseDisplayName(course.name, course.lesson_types, locale)}</span>
                    {course.name?.trim() && (
                      <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded shrink-0">
                        {lessonTypeName(course.lesson_types, locale) || '—'}
                      </span>
                    )}
                    <span className="text-xs text-gray-400 shrink-0">
                      {freqLabel[course.frequency] ?? course.frequency}
                    </span>
                    <span className="text-xs font-medium text-gray-500 shrink-0">
                      · {t('upcomingCount', { count: totalClasses })}
                    </span>
                  </div>

                  {/* Mobile: azioni prima della tabella orari */}
                  <div className="sm:hidden flex items-center gap-2 flex-wrap mt-2">{actionButtons}</div>

                  {course._schedules.length > 0 ? (
                    <div className="mt-2 space-y-1">
                      {course._schedules.map((sc, i) => (
                        <div key={i} className="flex items-center gap-2 flex-wrap">
                          <span className="inline-flex items-center gap-1.5 text-xs bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1">
                            {/* colore del singolo orario, non del corso */}
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: sc.color ?? course.color }} />
                            <span className="font-medium text-gray-700">{WEEKDAY_LABELS[sc.weekday] ?? sc.weekday}</span>
                            <span className="text-gray-300">·</span>
                            <span className="text-gray-500">{sc.start_time}</span>
                            <span className="text-gray-300">·</span>
                            <span className="text-gray-500">{sc.duration_minutes}min</span>
                            {/* insegnante della riga (fallback: insegnante del corso) */}
                            {(sc.teacher_name ?? course.teachers?.name) && (
                              <>
                                <span className="text-gray-300">·</span>
                                <span className="text-gray-500">{sc.teacher_name ?? course.teachers?.name}</span>
                              </>
                            )}
                            {/* online oppure 📍 sede · sala */}
                            {sc.is_online ? (
                              <>
                                <span className="text-gray-300">·</span>
                                <span className="text-gray-500">🌐 Online</span>
                              </>
                            ) : (
                              <>
                                <span className="text-gray-300">·</span>
                                <span className="text-gray-500">
                                  📍{sc.location_name ? ` ${sc.location_name}` : ' In presenza'}{sc.room_name ? ` · ${sc.room_name}` : ''}
                                </span>
                              </>
                            )}
                            {sc.max_capacity != null && (
                              <>
                                <span className="text-gray-300">·</span>
                                <span className="text-gray-500">👥 {sc.max_capacity}</span>
                              </>
                            )}
                            <span className="text-gray-300">·</span>
                            <span className="text-gray-500">{fmtDate(sc.first_date)} → {fmtDate(sc.last_date)}</span>
                            <span className="text-gray-300">·</span>
                            <span className="font-medium text-gray-600">{t('classCount', { count: sc.class_count })}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-300 mt-1">{t('noUpcoming')}</p>
                  )}
                  {course.notes && (
                    <p className="text-xs text-gray-500 mt-1.5">{course.notes}</p>
                  )}
                </div>

                <div className="hidden sm:flex items-center gap-2 shrink-0 mt-0.5">{actionButtons}</div>
              </div>
            )
          })}
        </div>
      )}

      {showBulkConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <h3 className="font-semibold text-gray-900 text-base">
              {t('bulkDeleteTitle', { count: selected.size })}
            </h3>
            <p className="text-sm text-gray-500">
              {t('bulkDeleteBody')}
            </p>
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleBulkDelete}
                className="flex-1 px-4 py-2.5 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 transition"
              >
                {t('bulkDeleteConfirm')}
              </button>
              <button
                onClick={() => setShowBulkConfirm(false)}
                className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition"
              >
                {t('bulkDeleteCancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
