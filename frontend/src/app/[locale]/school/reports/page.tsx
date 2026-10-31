'use client'

import { Link } from '@/navigation'
import { Fragment, Suspense, useEffect, useState, useCallback, useMemo, useRef, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import Tooltip from '@/components/ui/Tooltip'
import InfoHint from '@/components/ui/InfoHint'
import MultiFilterSelect from '@/components/ui/MultiFilterSelect'
import ColumnPicker from '@/components/ui/ColumnPicker'
import StudentUsageModal from '@/components/school/StudentUsageModal'
import { apiFetch, ApiError } from '@/lib/api/client'
import { exportCSV } from '@/lib/export-csv'
import { exportPDF, type ExportColumn, type ExportRow } from '@/lib/export'
import BalletLoader from '@/components/ui/BalletLoader'
import { formatMoney, formatNumber } from '@/lib/format-money'
import { localizedName, type TranslatedNames } from '@/lib/localized-name'
import { formatDate, formatDateTime, formatDateWeekday } from '@/lib/format-date'

// ── Types ─────────────────────────────────────────────────────────────────────

type LessonRow = {
  id: string
  name: string
  date: string
  start_time: string
  end_time: string
  is_online: boolean
  lesson_type_id: string | null
  lesson_type: TranslatedNames | null
  teacher: string
  teacher_id: string | null
  room: string
  room_id: string | null
  room_cost: number | null
  location: string
  location_id: string | null
  compensation_plan: string
  compensation_plan_id: string | null
  compensation_fee: number | null
  revenue: number
  profit: number | null
  revenue_warning: boolean
  capacity: number
  booked: number
  attended: number
  no_shows: number
  cancelled: number
  status: string
  // Shared by the lessons held on the same day, at the same time, by the same
  // teacher (the class in the room and its Zoom stream); null when alone
  concurrent_key: string | null
}

// One set of concurrent lessons as a single row (backend _concurrent_groups):
// the in-room lesson's plan, room and cost, everyone's students. Shown while
// the "merge concurrent lessons" switch is on, its lessons underneath.
// `frozen`: the school pinned the set (catalog.ConcurrentLessonGroup): merged
// whatever the switch says, and the teacher's compensation pays it once
type ConcurrentRow = LessonRow & { lesson_ids: string[]; frozen: boolean }
type LessonDisplayRow = LessonRow & { details?: LessonRow[]; frozen?: boolean }

// ── Lesson columns ───────────────────────────────────────────────────────────
// One list drives the header, the totals row, each row's cells, the CSV and
// the PDF, so the "Columns" menu trims them all at once (Carlo, 2026-10-31).
// `exportHeaders` may be more than one column: the Date cell carries the time,
// the export splits them.
type LessonRowVariant = 'single' | 'total' | 'detail'
type ExportFmt = 'csv' | 'pdf'
type LessonColumn = {
  key: string            // also the sort key when sortable
  label: string
  right?: boolean
  sortable?: boolean
  locked?: boolean       // cannot be hidden: the row's identity
  cellClass?: string | ((row: LessonDisplayRow, variant: LessonRowVariant) => string)
  cell: (row: LessonDisplayRow, variant: LessonRowVariant) => ReactNode
  total?: ReactNode      // the cell under the header; none = blank
  totalClass?: string
  exportHeaders: string[]
  exportValues: (row: LessonDisplayRow, fmt: ExportFmt) => (string | number)[]
  exportTotals: (fmt: ExportFmt) => (string | number)[]
}
// The hidden columns and the "merge concurrent" switch, remembered in this
// browser: set once, they survive clearing the filters and reloading
const LESSON_COLS_STORAGE = 'school-reports:lesson-columns'
const MERGE_STORAGE = 'school-reports:merge-concurrent'
// Column widths (px) once a header's right edge has been dragged; a column
// never measured gets DEFAULT_COL_WIDTH
const LESSON_WIDTHS_STORAGE = 'school-reports:lesson-col-widths'
const DEFAULT_COL_WIDTH = 120

type StudentRow = {
  id: string
  name: string
  email: string
  phone: string
  // In lessons, not credits: every package at this school (but deleted ones)
  // for total / used, the active ones for remaining; `lessons_partial` when
  // a package could not be told in lessons and was left out
  lessons_total: number
  lessons_used: number
  lessons_remaining: number
  lessons_partial: boolean
  last_attendance: string
  total_attended: number
  has_active_package: boolean
}

type TeacherRow = {
  id: string
  name: string
  lessons: number
  total_students: number
  attendance_rate: string
  compensation_estimate: number
}

type BookingsPage = {
  rows: BookingRow[]
  count: number
  page: number
  page_size: number
  kpis: { confirmed: number; attended: number; no_show: number; cancelled: number; credits: number | string }
}

type ReportsData = {
  // `truncated`: the period holds more lessons than the server's cap
  lessons: { rows: LessonRow[]; concurrent: Record<string, ConcurrentRow>; truncated: boolean }
  students: { total: number; avg_lessons_remaining: string; docs_expired: number; rows: StudentRow[] }
  teachers: { rows: TeacherRow[]; from: string; to: string }
}

type ReportSection = 'lessons' | 'students' | 'teachers'
const EMPTY_REPORTS: ReportsData = {
  lessons: { rows: [], concurrent: {}, truncated: false },
  students: { total: 0, avg_lessons_remaining: '0', docs_expired: 0, rows: [] },
  teachers: { rows: [], from: '', to: '' },
}
const SECTIONS_FOR_TAB: Partial<Record<Tab, ReportSection[]>> = {
  students: ['lessons', 'students'],
  // lessons, teachers: loaded by their own effects, with the period they show
}

type AttRow = {
  package_is_drop_in: boolean
  package_is_event_ticket?: boolean
  lesson_id: string
  date: string
  start_time: string
  course_name: string
  teacher_id: string | null
  teacher_name: string
  room_id: string | null
  room_name: string
  location_id: string | null
  location_name: string
  status: string
  credits_deducted: number
  access_source: string
}

type PkgSummary = {
  id: string
  credits_remaining: number
  credits_total: number
  expires_at: string
  status: string
}

type StudentClassRow = {
  student_id: string
  student_name: string
  packages: PkgSummary[]
  attendance: AttRow[]
}

type StudentClassesData = { rows: StudentClassRow[] }

// One booking made at the school (Bookings tab, /school/reports/bookings/)
// The source of a booking as a label key: a drop-in (single-lesson) package is
// its own source, "drop_in", whatever the catalog calls it, and a paid special
// event seat, booked as "package" with the event's own ticket, is an "event".
// The Bookings tab's Source column and its CSV go through this.
function sourceKey(r: { package_is_drop_in?: boolean; package_is_event_ticket?: boolean; access_source: string }) {
  return r.package_is_event_ticket ? 'event' : r.package_is_drop_in ? 'drop_in' : r.access_source
}

// Who did it (backend commerce.report_views._actor): the student herself, or a staff member
type Actor = { name: string; is_student: boolean }

type BookingRow = {
  id: string
  booked_at: string
  student_id: string
  student_name: string
  student_email: string
  lesson_id: string
  lesson_date: string
  start_time: string
  end_time: string
  course_name: string
  lesson_type: TranslatedNames
  lesson_status: string
  teacher_id: string | null
  teacher_name: string
  room_id: string | null
  room_name: string
  location_id: string | null
  location_name: string
  status: string
  access_source: string
  // The package that paid for it (null: free lesson, or package gone)
  student_package_id: string | null
  package_name: TranslatedNames
  package_is_drop_in: boolean
  package_is_event_ticket?: boolean
  lessons: number | null  // whole lessons at the package's cost, else null and the credits are shown
  created_by: Actor | null
  credits_deducted: number | string
  cancelled_at: string | null
  cancellation_type: string
  credit_refunded: boolean
}

type SortDir = 'asc' | 'desc'

// ── CSV helpers ───────────────────────────────────────────────────────────────

type Tab = 'bookings' | 'lessons' | 'students' | 'teachers' | 'packages'

function SortTh({ label, col, sortCol, sortDir, onSort, right, hint, hintAlign, sortable = true, width, onResizeStart }: {
  label: string; col: string; sortCol: string; sortDir: SortDir
  onSort: (col: string) => void; right?: boolean
  hint?: string; hintAlign?: 'center' | 'right'  // an "i" with the column's meaning
  sortable?: boolean                              // false: the same header, no sorting
  width?: number                                  // px, once the user has dragged a column (table-layout fixed)
  onResizeStart?: (e: ReactPointerEvent<HTMLElement>) => void  // the drag handle on the right edge
}) {
  const active = sortable && sortCol === col
  return (
    <th
      data-col={col}
      style={width ? { width } : undefined}
      onClick={sortable ? () => onSort(col) : undefined}
      className={`relative px-4 py-3 text-xs font-medium uppercase tracking-wide select-none whitespace-nowrap ${width ? 'overflow-hidden text-ellipsis' : ''} ${sortable ? 'cursor-pointer hover:text-gray-600' : ''} ${right ? 'text-right' : 'text-left'} ${active ? 'text-gray-700' : 'text-gray-400'}`}
    >
      {label} {sortable && (active ? (sortDir === 'asc' ? '↑' : '↓') : '↕')}
      {hint && <InfoHint text={hint} align={hintAlign} />}
      {onResizeStart && (
        <span
          role="separator"
          aria-orientation="vertical"
          onPointerDown={onResizeStart}
          onClick={e => e.stopPropagation()}
          className="absolute right-0 top-0 h-full w-2 cursor-col-resize touch-none hover:bg-gray-300/70"
        />
      )}
    </th>
  )
}

// Bookings tab: page size and the default "booked in the last…" window
const BK_PAGE_SIZES = [25, 50, 100]
const BK_DEFAULT_PAGE_SIZE = 25
type BkPeriod = '24h' | '7d' | '30d' | 'all'
const BK_DEFAULT_PERIOD: BkPeriod = '7d'
const BK_PERIODS: BkPeriod[] = ['24h', '7d', '30d', 'all']
// `names`: a lesson-type option carries its four names, the page picks the viewer's language
type BkOption = { value: string; label: string; names?: TranslatedNames | null }

// The local calendar day of an ISO timestamp — the same day the date cells
// show. Slicing the UTC string would file a row booked or bought just after
// midnight under the previous day.
// Today and the first of this month as YYYY-MM-DD in the browser's day
function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function monthStartIso(): string {
  return `${todayIso().slice(0, 7)}-01`
}
// The whole calendar month `offset` months from this one (0 = this, -1 = last)
function monthRangeIso(offset: number): { from: string; to: string } {
  const now = new Date()
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { from: iso(new Date(now.getFullYear(), now.getMonth() + offset, 1)), to: iso(new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)) }
}

function localDay(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SchoolReportsPage() {
  // Suspense: `useSearchParams` needs it (same pattern as school/students).
  return <Suspense><SchoolReportsPageInner /></Suspense>
}

function SchoolReportsPageInner() {
  const t = useTranslations('school.reports')
  // I18N-R3-09: the five CSV buttons built their header row out of English
  // object keys, so an Italian school exported "Credits Remaining" and
  // "Access Source". The table beside each one was already translated —
  // these are the same columns, so they reuse the same keys.
  const LESSON_STATUS_LABELS: Record<string, string> = {
    completed: t('statusCompleted'),
    cancelled: t('statusCancelled'),
    scheduled: t('statusScheduled'),
  }
  // I18N-R4-07: the cells wrote the raw enums next to translated headers
  const SOURCE_LABELS: Record<string, string> = { package: t('sourcePackage'), drop_in: t('sourceDropIn'), subscription: t('sourceSubscription'), free_lesson: t('sourceFreeLesson'), event: t('sourceEvent') }
  const BOOKING_STATUS_LABELS: Record<string, string> = { confirmed: t('bookingConfirmed'), attended: t('bookingAttended'), no_show: t('bookingNoShow'), cancelled: t('bookingCancelled') }
  const uiLocale = useLocale()

  const TABS: { id: Tab; label: string }[] = [
    { id: 'bookings', label: t('tabBookings') },
    { id: 'lessons', label: t('tabLessons') },
    { id: 'packages', label: t('tabPackages') },
    { id: 'students', label: t('tabStudents') },
    { id: 'teachers', label: t('tabTeachers') },
  ]

  // ?tab=packages&student=<id>: the "All packages, past ones too" link of the
  // usage modal (Students) lands here already filtered on that student.
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const wanted = searchParams.get('tab')
    return TABS.some(tab => tab.id === wanted) ? (wanted as Tab) : 'bookings'
  })

  // ── Tab Prenotazioni ──
  // Filtered, sorted and paged on the server: the page used to download every
  // booking and filter them in the browser, which slowed down with the school.
  const [bkRows, setBkRows] = useState<BookingRow[]>([])
  const [bkCount, setBkCount] = useState(0)
  const [bkKpiData, setBkKpiData] = useState<BookingsPage['kpis']>({ confirmed: 0, attended: 0, no_show: 0, cancelled: 0, credits: 0 })
  const [bkLoading, setBkLoading] = useState(false)
  const [bkLoaded, setBkLoaded] = useState(false)
  const [bkError, setBkError] = useState<string | null>(null)
  const [bkPeriod, setBkPeriod] = useState<BkPeriod>(BK_DEFAULT_PERIOD)
  const [bkPage, setBkPage] = useState(1)
  const [bkPageSize, setBkPageSize] = useState(BK_DEFAULT_PAGE_SIZE)
  const [bkExporting, setBkExporting] = useState(false)
  const [bkFilterFrom, setBkFilterFrom] = useState('')
  const [bkFilterTo, setBkFilterTo] = useState('')
  const [bkFilterLessonFrom, setBkFilterLessonFrom] = useState('')  // the lesson's own day
  const [bkFilterLessonTo, setBkFilterLessonTo] = useState('')
  const [bkFilterStudent, setBkFilterStudent] = useState<string[]>([])
  const [bkFilterTeacher, setBkFilterTeacher] = useState<string[]>([])
  const [bkFilterLocation, setBkFilterLocation] = useState<string[]>([])
  const [bkFilterStatus, setBkFilterStatus] = useState<string[]>([])
  const [bkFilterSource, setBkFilterSource] = useState<string[]>([])
  const [bkFilterLesson, setBkFilterLesson] = useState<string[]>([])  // course:<id> / type:<id>
  const [bkSortCol, setBkSortCol] = useState<'booked_at' | 'lesson_date' | 'student'>('booked_at')
  const [bkSortDir, setBkSortDir] = useState<SortDir>('desc')
  const [bkOptions, setBkOptions] = useState<{ students: BkOption[]; teachers: BkOption[]; locations: BkOption[]; lessons: BkOption[] }>({ students: [], teachers: [], locations: [], lessons: [] })

  // Any filter change goes back to page 1; the filters themselves survive paging
  const bkFilter = <T,>(set: (v: T) => void) => (v: T) => { set(v); setBkPage(1) }

  const bkHasFilters = bkPeriod !== BK_DEFAULT_PERIOD || Boolean(bkFilterFrom || bkFilterTo || bkFilterLessonFrom || bkFilterLessonTo) || bkFilterStudent.length > 0 || bkFilterTeacher.length > 0
    || bkFilterLocation.length > 0 || bkFilterStatus.length > 0 || bkFilterSource.length > 0 || bkFilterLesson.length > 0

  // Same query for the page and the export; only the paging bits differ
  const bkQuery = useCallback((extra: Record<string, string>) => {
    const q = new URLSearchParams(extra)
    // A date range replaces the preset window (the server ignores `period` then)
    if (bkFilterFrom || bkFilterTo) {
      if (bkFilterFrom) q.set('booked_from', bkFilterFrom)
      if (bkFilterTo) q.set('booked_to', bkFilterTo)
    } else {
      q.set('period', bkPeriod)
    }
    // The lesson's day adds up with the booking window
    if (bkFilterLessonFrom) q.set('lesson_from', bkFilterLessonFrom)
    if (bkFilterLessonTo) q.set('lesson_to', bkFilterLessonTo)
    if (bkFilterStudent.length) q.set('student', bkFilterStudent.join(','))
    if (bkFilterTeacher.length) q.set('teacher', bkFilterTeacher.join(','))
    if (bkFilterLocation.length) q.set('location', bkFilterLocation.join(','))
    if (bkFilterStatus.length) q.set('status', bkFilterStatus.join(','))
    if (bkFilterSource.length) q.set('source', bkFilterSource.join(','))
    if (bkFilterLesson.length) q.set('lesson', bkFilterLesson.join(','))
    q.set('sort', bkSortCol)
    q.set('dir', bkSortDir)
    return q.toString()
  }, [bkPeriod, bkFilterFrom, bkFilterTo, bkFilterLessonFrom, bkFilterLessonTo, bkFilterStudent, bkFilterTeacher, bkFilterLocation, bkFilterStatus, bkFilterSource, bkFilterLesson, bkSortCol, bkSortDir])

  // Latest request wins: a slow answer for an old filter must not overwrite a newer one
  const bkRequest = useRef(0)
  useEffect(() => {
    if (activeTab !== 'bookings') return
    const id = ++bkRequest.current
    setBkLoading(true)
    setBkError(null)
    apiFetch<BookingsPage>(`/school/reports/bookings/?${bkQuery({ page: String(bkPage), page_size: String(bkPageSize) })}`)
      .then(d => {
        if (id !== bkRequest.current) return
        setBkRows(d.rows)
        setBkCount(d.count)
        setBkKpiData(d.kpis)
        setBkLoaded(true)
      })
      .catch(() => { if (id === bkRequest.current) setBkError(t('error')) })
      .finally(() => { if (id === bkRequest.current) setBkLoading(false) })
  }, [activeTab, bkQuery, bkPage, bkPageSize, t])

  // Filter dropdown choices (students / teachers / locations with bookings)
  const [bkOptionsLoaded, setBkOptionsLoaded] = useState(false)
  useEffect(() => {
    if (activeTab !== 'bookings' || bkOptionsLoaded) return
    setBkOptionsLoaded(true)
    apiFetch<{ students: BkOption[]; teachers: BkOption[]; locations: BkOption[]; lessons: BkOption[] }>('/school/reports/bookings/?options=1')
      .then(setBkOptions)
      .catch(() => setBkOptionsLoaded(false))
  }, [activeTab, bkOptionsLoaded])

  const bkPages = Math.max(1, Math.ceil(bkCount / bkPageSize))
  const bkKpis = {
    total: bkCount,
    confirmed: bkKpiData.confirmed,
    attended: bkKpiData.attended,
    noShows: bkKpiData.no_show,
    cancelled: bkKpiData.cancelled,
    credits: Number(bkKpiData.credits),
  }

  function handleBkSort(col: string) {
    const key = col as 'booked_at' | 'lesson_date' | 'student'
    if (bkSortCol === key) setBkSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setBkSortCol(key); setBkSortDir(key === 'student' ? 'asc' : 'desc') }
    setBkPage(1)
  }

  function handlePkSort(col: string) {
    const key = col as 'student' | 'purchased' | 'expires'
    if (pkSortCol === key) setPkSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setPkSortCol(key); setPkSortDir(key === 'student' ? 'asc' : 'desc') }
  }

  // Course name, else the lesson type in the viewer's language
  const bkLessonName = (r: BookingRow) => r.course_name || localizedName(r.lesson_type, uiLocale, '—')
  // Lessons, not credits: the backend says how many whole lessons the booking
  // was at its package's cost; otherwise the credits, with the unit
  const bkLessons = (r: BookingRow) => (r.lessons != null ? String(r.lessons) : `${Number(r.credits_deducted)} cr`)
  const actorLabel = (a: Actor | null) => (a ? (a.is_student ? t('byStudent') : a.name) : '—')
  // The package that paid, by name in the viewer's language; else the source label
  const bkSourceName = (r: BookingRow) => {
    const key = sourceKey(r)
    if (key === 'event' || key === 'drop_in') return SOURCE_LABELS[key]
    // any other package-paid booking shows the package's own name
    return r.student_package_id ? localizedName(r.package_name, uiLocale, SOURCE_LABELS.package) : (SOURCE_LABELS[key] ?? key)
  }
  const fmtDay = (iso: string) => formatDate(iso)
  const fmtDateTime = (iso: string) => formatDateTime(iso)
  const fmtLessonDate = (day: string) => formatDateWeekday(day, uiLocale)

  // ── Tab Pacchetti e abbonamenti ──
  type PkRow = { id: string; kind: 'package' | 'subscription'; student_id: string; student_name: string; product: TranslatedNames; total: number | null; remaining: number | null; started_at: string; ends_at: string | null; status: string; payment_method: string | null; lesson_credit_cost: string | null; lessons_total: number | null; lessons_remaining: number | null; assigned_by: Actor | null }
  const [pkRows, setPkRows] = useState<PkRow[] | null>(null)
  const [pkLoading, setPkLoading] = useState(false)
  const [pkFilterStudent, setPkFilterStudent] = useState<string[]>(() => {
    const student = searchParams.get('student')
    return student ? [student] : []
  })
  const [pkFilterProduct, setPkFilterProduct] = useState<string[]>([])
  const [pkFilterKind, setPkFilterKind] = useState<string[]>([])
  const [pkFilterStatus, setPkFilterStatus] = useState<string[]>([])
  const [pkFilterFrom, setPkFilterFrom] = useState('')
  const [pkFilterTo, setPkFilterTo] = useState('')
  const [pkFilterExpFrom, setPkFilterExpFrom] = useState('')  // expiry day
  const [pkFilterExpTo, setPkFilterExpTo] = useState('')
  const [pkSortCol, setPkSortCol] = useState<'student' | 'purchased' | 'expires'>('purchased')
  const [pkSortDir, setPkSortDir] = useState<SortDir>('desc')
  // The usage modal for ONE package: Bookings (click on the Source cell) and
  // Packages (click on the row) open the same component as Students, but in
  // package mode — that package only, with the bookings paid with it.
  const [usageTarget, setUsageTarget] = useState<{ studentPackageId: string; studentName: string } | null>(null)
  const [data, setData] = useState<ReportsData>(EMPTY_REPORTS)
  const [loadedSections, setLoadedSections] = useState<ReportSection[]>([])
  const [error, setError] = useState<string | null>(null)

  // Student Classes data (lazy loaded)
  const [scData, setScData] = useState<StudentClassesData | null>(null)
  const [scLoading, setScLoading] = useState(false)

  // Lesson filters
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [filterTeacher, setFilterTeacher] = useState<string[]>([])
  const [filterLocation, setFilterLocation] = useState<string[]>([])
  const [filterRoom, setFilterRoom] = useState<string[]>([])
  const [filterCompPlan, setFilterCompPlan] = useState<string[]>([])
  const [filterLessonType, setFilterLessonType] = useState<string[]>([])
  // "Merge concurrent lessons": the class in the room and its Zoom stream as
  // one yellow row (Carlo, 2026-09-28); off until switched on, then remembered
  // in this browser like the columns (Carlo, 2026-10-31)
  const [mergeConcurrent, setMergeConcurrent] = useState(false)
  const changeMergeConcurrent = (on: boolean) => {
    setMergeConcurrent(on)
    try { localStorage.setItem(MERGE_STORAGE, on ? '1' : '0') } catch { /* per-browser convenience only */ }
  }
  // "Columns" menu: the hidden lesson columns (the CSV and the PDF follow the
  // table), read back from this browser on mount
  const [hiddenLessonCols, setHiddenLessonCols] = useState<string[]>([])
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(LESSON_COLS_STORAGE) ?? '[]')
      if (Array.isArray(saved)) setHiddenLessonCols(saved.filter((k): k is string => typeof k === 'string'))
      if (localStorage.getItem(MERGE_STORAGE) === '1') setMergeConcurrent(true)
      const widths: unknown = JSON.parse(localStorage.getItem(LESSON_WIDTHS_STORAGE) ?? '{}')
      if (widths && typeof widths === 'object' && !Array.isArray(widths)) {
        const clean = Object.fromEntries(
          Object.entries(widths as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number'),
        )
        lessonColWidthsRef.current = clean
        setLessonColWidths(clean)
      }
    } catch { /* storage blocked or garbage: every column shown, merge off, auto widths */ }
  }, [])
  const changeHiddenLessonCols = (hidden: string[]) => {
    setHiddenLessonCols(hidden)
    try { localStorage.setItem(LESSON_COLS_STORAGE, JSON.stringify(hidden)) } catch { /* per-browser convenience only */ }
  }
  const [pdfExporting, setPdfExporting] = useState(false)
  // Column widths, once a header's right edge has been dragged. The first
  // drag fixes every column at its current width, so only that one moves.
  const [lessonColWidths, setLessonColWidths] = useState<Record<string, number>>({})
  const lessonColWidthsRef = useRef<Record<string, number>>({})
  // the drag in progress, so unmounting mid-drag detaches its document listeners
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => () => { resizeCleanupRef.current?.() }, [])
  const saveLessonColWidths = (widths: Record<string, number>) => {
    lessonColWidthsRef.current = widths
    setLessonColWidths(widths)
    try {
      if (Object.keys(widths).length) localStorage.setItem(LESSON_WIDTHS_STORAGE, JSON.stringify(widths))
      else localStorage.removeItem(LESSON_WIDTHS_STORAGE)
    } catch { /* per-browser convenience only */ }
  }
  const startLessonColResize = (key: string) => (e: ReactPointerEvent<HTMLElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const table = e.currentTarget.closest('table')
    if (!table) return
    const widths = { ...lessonColWidthsRef.current }
    table.querySelectorAll<HTMLTableCellElement>('thead th[data-col]').forEach(cell => {
      const k = cell.dataset.col
      if (k && !widths[k]) widths[k] = Math.round(cell.getBoundingClientRect().width)
    })
    const startX = e.clientX
    const startW = widths[key] ?? DEFAULT_COL_WIDTH
    const onMove = (ev: PointerEvent) => {
      const next = { ...widths, [key]: Math.max(48, Math.round(startW + ev.clientX - startX)) }
      lessonColWidthsRef.current = next
      setLessonColWidths(next)
    }
    const detach = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      resizeCleanupRef.current = null
    }
    const onUp = () => {
      detach()
      saveLessonColWidths(lessonColWidthsRef.current)
    }
    resizeCleanupRef.current?.()
    resizeCleanupRef.current = detach
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    lessonColWidthsRef.current = widths
    setLessonColWidths(widths)
  }
  const lessonTableSized = Object.keys(lessonColWidths).length > 0
  const lessonColWidth = (key: string) => lessonColWidths[key] ?? DEFAULT_COL_WIDTH
  // The lock on a yellow row: pin / unpin that set of concurrent lessons on
  // the server (the school's choice, Compensation follows it)
  const [pinning, setPinning] = useState<string | null>(null)
  const [pinError, setPinError] = useState<string | null>(null)

  // Student filters
  const [sFilterFrom, setSFilterFrom] = useState('')
  const [sFilterTo, setSFilterTo] = useState('')
  // "Who came once last month": lessons used / total as min..max, last
  // attendance as a date range (Carlo, 2026-09-28)
  const [sUsedMin, setSUsedMin] = useState('')
  const [sUsedMax, setSUsedMax] = useState('')
  const [sTotalMin, setSTotalMin] = useState('')
  const [sTotalMax, setSTotalMax] = useState('')
  const [sLastFrom, setSLastFrom] = useState('')
  const [sLastTo, setSLastTo] = useState('')
  const [sFilterTeacher, setSFilterTeacher] = useState<string[]>([])
  const [sFilterLocation, setSFilterLocation] = useState<string[]>([])
  const [sFilterRoom, setSFilterRoom] = useState<string[]>([])

  // Student Classes filters

  // Lesson sort
  const [lessonSortCol, setLessonSortCol] = useState('date')
  const [lessonSortDir, setLessonSortDir] = useState<SortDir>('desc')

  // Student sort
  const [studentSortCol, setStudentSortCol] = useState('name')
  const [studentSortDir, setStudentSortDir] = useState<SortDir>('asc')

  // Teacher sort
  const [teacherSortCol, setTeacherSortCol] = useState('name')
  const [teacherSortDir, setTeacherSortDir] = useState<SortDir>('asc')

  // Each tab asks the server only for the sections it shows (?tab=): the
  // Students tab also needs the lessons, whose rows feed its filter dropdowns.
  const neededSections = SECTIONS_FOR_TAB[activeTab] ?? []
  const loading = neededSections.some(sec => !loadedSections.includes(sec)) && !error
  const requestedSections = useRef<Set<ReportSection>>(new Set())
  useEffect(() => {
    for (const sec of neededSections) {
      if (requestedSections.current.has(sec)) continue
      requestedSections.current.add(sec)
      apiFetch<Partial<ReportsData>>(`/school/reports/detailed/?tab=${sec}`)
        .then(res => {
          setData(prev => ({ ...prev, ...res }))
          setLoadedSections(prev => [...prev, sec])
        })
        .catch(() => { requestedSections.current.delete(sec); setError(t('error')) })
    }
    // neededSections is derived from activeTab
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, t])

  // ── Lessons tab: the lessons of the period in the date filter, future ones
  // included, so next month's room and teacher costs can be estimated (Carlo,
  // 2026-10-08); refetched whenever the dates change. No dates: the newest
  // lessons up to today, as before. The rows of the Students tab's fallback
  // dropdowns stay in `data.lessons`.
  const [lessonsData, setLessonsData] = useState<ReportsData['lessons'] | null>(null)
  const [lLoading, setLLoading] = useState(false)
  const lRequest = useRef(0)
  const lLoadedKey = useRef<string | null>(null)
  useEffect(() => {
    if (activeTab !== 'lessons') return
    if (filterFrom && filterTo && filterFrom > filterTo) return  // the wrong way round: keep what is shown
    const key = `${filterFrom}|${filterTo}`
    if (lLoadedKey.current === key) return
    const id = ++lRequest.current
    setLLoading(true)
    const q = new URLSearchParams({ tab: 'lessons' })
    if (filterFrom) q.set('from', filterFrom)
    if (filterTo) q.set('to', filterTo)
    apiFetch<Pick<ReportsData, 'lessons'>>(`/school/reports/detailed/?${q}`)
      .then(res => { if (id === lRequest.current) { setLessonsData(res.lessons); lLoadedKey.current = key } })
      .catch(() => { if (id === lRequest.current) setError(t('error')) })
      .finally(() => { if (id === lRequest.current) setLLoading(false) })
  }, [activeTab, filterFrom, filterTo, t])

  // lazy load tab pacchetti
  useEffect(() => {
    if (activeTab !== 'packages' || pkRows || pkLoading) return
    setPkLoading(true)
    apiFetch<{ rows: PkRow[] }>('/school/reports/packages/')
      .then(d => setPkRows(d.rows ?? []))
      .catch(() => setPkRows([]))
      .finally(() => setPkLoading(false))
  }, [activeTab, pkRows, pkLoading])

  // ── Derived filter options from lessons ──────────────────────────────────────
  // The Lessons tab's rows (its period), else the default set the Students
  // tab loads for its fallback dropdowns

  const lessonRows = lessonsData?.rows ?? data.lessons.rows

  const teachers = useMemo(() => {
    const seen = new Set<string>()
    return lessonRows
      .filter(r => r.teacher !== '—' && r.teacher_id && !seen.has(r.teacher_id) && seen.add(r.teacher_id))
      .map(r => ({ id: r.teacher_id!, name: r.teacher }))
  }, [lessonRows])

  const locations = useMemo(() => {
    const seen = new Set<string>()
    return lessonRows
      .filter(r => r.location !== '—' && r.location_id && !seen.has(r.location_id) && seen.add(r.location_id))
      .map(r => ({ id: r.location_id!, name: r.location }))
  }, [lessonRows])

  const rooms = useMemo(() => {
    const seen = new Set<string>()
    return lessonRows
      .filter(r => r.room !== '—' && r.room_id &&
        (filterLocation.length === 0 || filterLocation.includes(r.location_id ?? '')) &&
        !seen.has(r.room_id) && seen.add(r.room_id))
      .map(r => ({ id: r.room_id!, name: r.room }))
  }, [lessonRows, filterLocation])

  const compensationPlans = useMemo(() => {
    const seen = new Set<string>()
    return lessonRows
      .filter(r => r.compensation_plan !== '—' && r.compensation_plan_id && !seen.has(r.compensation_plan_id) && seen.add(r.compensation_plan_id))
      .map(r => ({ id: r.compensation_plan_id!, name: r.compensation_plan }))
  }, [lessonRows])

  const lessonTypes = useMemo(() => {
    const seen = new Set<string>()
    return lessonRows
      .filter(r => r.lesson_type_id && !seen.has(r.lesson_type_id) && seen.add(r.lesson_type_id))
      .map(r => ({ id: r.lesson_type_id!, name: r.lesson_type ? localizedName(r.lesson_type, uiLocale, '—') : '—' }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [lessonRows, uiLocale])

  // ── Derived filter options for students tab (from attendance data) ──────────

  const sTeachers = useMemo(() => {
    if (!scData) return teachers  // fallback to lesson teachers
    const seen = new Set<string>()
    const result: { id: string; name: string }[] = []
    for (const s of scData.rows) {
      for (const a of s.attendance) {
        if (a.teacher_id && !seen.has(a.teacher_id)) {
          seen.add(a.teacher_id)
          result.push({ id: a.teacher_id, name: a.teacher_name })
        }
      }
    }
    return result
  }, [scData, teachers])

  const sLocations = useMemo(() => {
    if (!scData) return locations
    const seen = new Set<string>()
    const result: { id: string; name: string }[] = []
    for (const s of scData.rows) {
      for (const a of s.attendance) {
        if (a.location_id && !seen.has(a.location_id)) {
          seen.add(a.location_id)
          result.push({ id: a.location_id, name: a.location_name })
        }
      }
    }
    return result
  }, [scData, locations])

  const sRooms = useMemo(() => {
    if (!scData) return rooms
    const seen = new Set<string>()
    const result: { id: string; name: string }[] = []
    for (const s of scData.rows) {
      for (const a of s.attendance) {
        if (a.room_id && (sFilterLocation.length === 0 || sFilterLocation.includes(a.location_id ?? '')) && !seen.has(a.room_id)) {
          seen.add(a.room_id)
          result.push({ id: a.room_id, name: a.room_name })
        }
      }
    }
    return result
  }, [scData, rooms, sFilterLocation])

  // ── Filtered + sorted lessons ───────────────────────────────────────────────

  const filteredLessons = useMemo<LessonDisplayRow[]>(() => {
    if (!lessonsData) return []
    const matches = (r: LessonRow) =>
      (!filterFrom || r.date >= filterFrom) &&
      (!filterTo || r.date <= filterTo) &&
      (!filterTeacher.length || filterTeacher.includes(r.teacher_id ?? '')) &&
      (!filterLocation.length || filterLocation.includes(r.location_id ?? '')) &&
      (!filterRoom.length || filterRoom.includes(r.room_id ?? '')) &&
      (!filterCompPlan.length || filterCompPlan.includes(r.compensation_plan_id ?? '')) &&
      (!filterLessonType.length || filterLessonType.includes(r.lesson_type_id ?? ''))
    // A set of concurrent lessons (same day, time and teacher: the class in
    // the room and its Zoom stream) is one row, the backend's merged one, with
    // its lessons underneath, while the switch is on -- or always, once the
    // school pinned that set (`frozen`). It stays when any of them matches.
    const byId = new Map(lessonsData.rows.map(r => [r.id, r]))
    const rows: LessonDisplayRow[] = []
    const done = new Set<string>()
    for (const r of lessonsData.rows) {
      const group = r.concurrent_key ? lessonsData.concurrent[r.concurrent_key] : undefined
      if (!group || !(mergeConcurrent || group.frozen)) {
        if (matches(r)) rows.push(r)
        continue
      }
      if (done.has(group.id)) continue
      done.add(group.id)
      // its lessons in the backend's order: the one that leads the row first
      const details = group.lesson_ids.flatMap(id => byId.get(id) ?? [])
      if (details.some(matches)) rows.push({ ...group, details })
    }
    return rows.sort((a, b) => {
      const av = a[lessonSortCol as keyof LessonRow]
      const bv = b[lessonSortCol as keyof LessonRow]
      // null/undefined sempre in fondo, a prescindere dalla direzione
      if (av === null || av === undefined) return 1
      if (bv === null || bv === undefined) return -1
      // confronto numerico vero: localeCompare "numeric" ignora il segno meno
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv), undefined, { numeric: true })
      return lessonSortDir === 'asc' ? cmp : -cmp
    })
  }, [lessonsData, filterFrom, filterTo, filterTeacher, filterLocation, filterRoom, filterCompPlan, filterLessonType, mergeConcurrent, lessonSortCol, lessonSortDir])

  // Totali per la riga sotto le intestazioni (analisi KPI, per Carlo)
  const lessonTotals = useMemo(() => {
    const sum = (fn: (r: LessonRow) => number) => filteredLessons.reduce((s, r) => s + fn(r), 0)
    const roomCost = sum(r => Number(r.room_cost ?? 0))
    const compFee = sum(r => Number(r.compensation_fee ?? 0))
    const revenue = sum(r => Number(r.revenue ?? 0))
    const profit = sum(r => Number(r.profit ?? 0))
    const capacity = sum(r => r.capacity)
    const booked = sum(r => r.booked)
    const attended = sum(r => r.attended)
    const noShows = sum(r => r.no_shows)
    const cancelled = sum(r => r.cancelled)
    return { roomCost, compFee, revenue, profit, capacity, booked, attended, noShows, cancelled }
  }, [filteredLessons])

  const pct = (num: number, den: number) => den > 0 ? `${Math.round(num / den * 100)}%` : '—'

  // CSV: a bare number (two decimals) or empty, for the spreadsheet; PDF: the
  // same text as the screen, the currency in the header
  const moneyOut = (v: number | null, fmt: ExportFmt): string =>
    v === null ? (fmt === 'csv' ? '' : '—') : fmt === 'csv' ? Number(v).toFixed(2) : formatNumber(Number(v), uiLocale, { decimals: 2 })
  const pctOut = (num: number, den: number, fmt: ExportFmt): string | number =>
    den > 0 ? (fmt === 'csv' ? Math.round(num / den * 100) : pct(num, den)) : (fmt === 'csv' ? '' : '—')

  const textCol = (key: string, label: string, value: (r: LessonDisplayRow) => string, cellClass: string): LessonColumn => ({
    key, label, sortable: true, cellClass, cell: r => value(r),
    exportHeaders: [label], exportValues: r => [value(r)], exportTotals: () => [''],
  })
  const moneyCol = (
    key: string, label: string, value: (r: LessonDisplayRow) => number | null, total: number,
    cellClass: LessonColumn['cellClass'], totalClass?: string,
  ): LessonColumn => ({
    key, label, right: true, sortable: true, cellClass, totalClass,
    cell: r => { const v = value(r); return v !== null ? formatMoney(Number(v), uiLocale) : '—' },
    total: formatMoney(total, uiLocale),
    exportHeaders: [`${label} (€)`], exportValues: (r, f) => [moneyOut(value(r), f)], exportTotals: f => [moneyOut(total, f)],
  })
  const countCol = (
    key: string, label: string, value: (r: LessonDisplayRow) => number, total: number,
    cellClass: string, totalClass?: string,
  ): LessonColumn => ({
    key, label, right: true, sortable: true, cellClass, totalClass, cell: r => value(r), total,
    exportHeaders: [label], exportValues: r => [value(r)], exportTotals: () => [total],
  })
  const rateCol = (
    key: string, label: string, num: (r: LessonDisplayRow) => number, den: (r: LessonDisplayRow) => number,
    totalNum: number, totalDen: number, cellClass: string, totalClass?: string,
  ): LessonColumn => ({
    key, label, right: true, cellClass, totalClass, cell: r => pct(num(r), den(r)), total: pct(totalNum, totalDen),
    exportHeaders: [label], exportValues: (r, f) => [pctOut(num(r), den(r), f)], exportTotals: f => [pctOut(totalNum, totalDen, f)],
  })

  const lessonColumns: LessonColumn[] = [
    {
      key: 'name', label: t('colLesson'), sortable: true, locked: true,
      cellClass: (_r, variant) => `whitespace-nowrap ${variant === 'detail' ? 'pl-10 text-gray-600' : 'font-medium text-gray-900'}`,
      // a merged total row (yellow) shows how many lessons it holds; a detail under it is indented
      cell: (row, variant) => (
        <>
          {variant === 'detail' && <span className="text-gray-400 mr-1.5">↳</span>}
          {row.name}
          {variant === 'total' && row.details && (
            <span className="ml-2 text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-yellow-200 text-yellow-900">
              {t('concurrentLessons', { count: row.details.length })}
            </span>
          )}
          {variant === 'total' && row.concurrent_key && (
            <button
              type="button"
              aria-pressed={!!row.frozen}
              disabled={pinning === row.concurrent_key}
              title={row.frozen ? t('unpinHint') : t('pinHint')}
              onClick={() => { if (row.concurrent_key) togglePin(row.concurrent_key, !row.frozen) }}
              className={`ml-2 inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full align-middle transition disabled:opacity-50 ${row.frozen
                ? 'bg-[#6B1F3A] text-white hover:bg-[#531730]'
                : 'border border-gray-300 bg-white text-gray-500 hover:border-gray-400 hover:text-gray-700'}`}
            >
              <span aria-hidden="true">{row.frozen ? '🔒' : '🔓'}</span>
              {row.frozen ? t('pinOn') : t('pinOff')}
            </button>
          )}
          {variant !== 'total' && row.is_online && (
            <span className="ml-1.5 text-[11px] text-blue-600">{t('onlineBadge')}</span>
          )}
        </>
      ),
      total: t('totalsRow'),
      exportHeaders: [t('colLesson')], exportValues: r => [r.name], exportTotals: () => [t('totalsRow')],
    },
    {
      key: 'date', label: t('colDate'), sortable: true, cellClass: 'text-gray-500 whitespace-nowrap',
      cell: row => (
        <>
          {formatDate(row.date)}
          <span className="ml-1.5 text-xs text-gray-400">{row.start_time.slice(0, 5)}</span>
        </>
      ),
      exportHeaders: [t('colDate'), t('colTime')],
      exportValues: r => [formatDate(r.date), r.start_time.slice(0, 5)],
      exportTotals: () => ['', ''],
    },
    textCol('teacher', t('colTeacher'), r => r.teacher, 'text-gray-600'),
    textCol('location', t('colLocation'), r => r.location, 'text-gray-500 text-xs'),
    textCol('room', t('colRoom'), r => r.room, 'text-gray-500 text-xs'),
    moneyCol('room_cost', t('colRoomCost'), r => r.room_cost, lessonTotals.roomCost, 'text-right text-gray-500 text-xs'),
    textCol('compensation_plan', t('colCompPlan'), r => r.compensation_plan, 'text-gray-500 text-xs whitespace-nowrap'),
    moneyCol('compensation_fee', t('colCompFee'), r => r.compensation_fee, lessonTotals.compFee, 'text-right text-gray-700 whitespace-nowrap'),
    {
      ...moneyCol('revenue', t('colRevenue'), r => r.revenue, lessonTotals.revenue, 'text-right text-gray-700 whitespace-nowrap'),
      cell: row => (
        <>
          {formatMoney(Number(row.revenue), uiLocale)}
          {row.revenue_warning && <span title={t('revenueWarning')} className="ml-1">⚠️</span>}
        </>
      ),
    },
    moneyCol(
      'profit', t('colProfit'), r => r.profit, lessonTotals.profit,
      row => `text-right font-semibold whitespace-nowrap ${(row.profit ?? 0) >= 0 ? 'text-green-700' : 'text-red-500'}`,
      lessonTotals.profit >= 0 ? 'text-green-700' : 'text-red-500',
    ),
    countCol('capacity', t('colCapacity'), r => r.capacity, lessonTotals.capacity, 'text-right text-gray-900'),
    countCol('booked', t('colBooked'), r => r.booked, lessonTotals.booked, 'text-right text-gray-900'),
    rateCol('booked_rate', t('colBookedRate'), r => r.booked, r => r.capacity, lessonTotals.booked, lessonTotals.capacity, 'text-right text-gray-500'),
    {
      ...countCol('attended', t('colAttended'), r => r.attended, lessonTotals.attended, 'text-right font-semibold text-green-700', 'text-green-700'),
      // On a lesson held: nobody = red, one = amber, more = green (Carlo, 2026-10-31)
      cellClass: row => `text-right font-semibold ${row.status !== 'completed' ? 'text-gray-400'
        : row.attended === 0 ? 'text-red-600' : row.attended === 1 ? 'text-amber-500' : 'text-green-700'}`,
    },
    rateCol('attended_rate', t('colAttendedRate'), r => r.attended, r => r.booked, lessonTotals.attended, lessonTotals.booked, 'text-right text-green-700', 'text-green-700'),
    countCol('no_shows', t('colNoShows'), r => r.no_shows, lessonTotals.noShows, 'text-right font-semibold text-red-500', 'text-red-500'),
    rateCol('no_show_rate', t('colNoShowRate'), r => r.no_shows, r => r.booked, lessonTotals.noShows, lessonTotals.booked, 'text-right text-red-500', 'text-red-500'),
    countCol('cancelled', t('colCancelledBookings'), r => r.cancelled, lessonTotals.cancelled, 'text-right text-gray-500', 'text-gray-500'),
    rateCol(
      'cancelled_rate', t('colCancelledRate'), r => r.cancelled, r => r.booked + r.cancelled,
      lessonTotals.cancelled, lessonTotals.booked + lessonTotals.cancelled, 'text-right text-gray-500', 'text-gray-500',
    ),
    {
      key: 'status', label: t('colStatus'), sortable: true,
      cell: row => (
        <span className={`text-xs px-2 py-0.5 rounded-full ${
          row.status === 'completed' ? 'bg-green-100 text-green-700' :
          row.status === 'cancelled' ? 'bg-red-100 text-red-600' :
          'bg-blue-100 text-blue-700'
        }`}>{LESSON_STATUS_LABELS[row.status] ?? row.status}</span>
      ),
      exportHeaders: [t('colStatus')], exportValues: r => [LESSON_STATUS_LABELS[r.status] ?? r.status], exportTotals: () => [''],
    },
  ]
  const visibleLessonColumns = lessonColumns.filter(c => c.locked || !hiddenLessonCols.includes(c.key))

  // One lesson's cells, the same columns for a plain row, a merged total row
  // (yellow, with the count of lessons in it) and the lessons under it (indented)
  const lessonCells = (row: LessonDisplayRow, variant: LessonRowVariant) => visibleLessonColumns.map(c => (
    <td key={c.key} className={`px-4 py-3 ${lessonTableSized ? 'overflow-hidden text-ellipsis' : ''} ${typeof c.cellClass === 'function' ? c.cellClass(row, variant) : (c.cellClass ?? '')}`}>
      {c.cell(row, variant)}
    </td>
  ))

  // The visible columns as exported, the totals row last. Merged: the yellow
  // total row, then its lessons, each told apart by a first "Row" column.
  const exportLessonRows = (fmt: ExportFmt) => {
    const flat = filteredLessons.flatMap(r => r.details
      ? [{ r, kind: 'total' as LessonRowVariant }, ...r.details.map(d => ({ r: d, kind: 'detail' as LessonRowVariant }))]
      : [{ r, kind: 'single' as LessonRowVariant }])
    const kindLabel: Record<LessonRowVariant, string> = { total: t('rowKindTotal'), detail: t('rowKindDetail'), single: '' }
    // the "Row" column tells a merged total from its lessons: whenever one is
    // on screen (the switch, or a pinned set)
    const anyMerged = filteredLessons.some(r => r.details)
    const lead = <T,>(v: T): T[] => anyMerged ? [v] : []
    return {
      headers: [...lead(t('colRowKind')), ...visibleLessonColumns.flatMap(c => c.exportHeaders)],
      rows: flat.map(({ r, kind }) => [...lead(kindLabel[kind]), ...visibleLessonColumns.flatMap(c => c.exportValues(r, fmt))]),
      totals: [...lead(''), ...visibleLessonColumns.flatMap(c => c.exportTotals(fmt))],
      kinds: flat.map(f => f.kind),
      // right-aligned export columns by position (a Date entry spans two)
      right: [...lead(false), ...visibleLessonColumns.flatMap(c => c.exportHeaders.map(() => !!c.right))],
    }
  }

  const exportLessonsCSV = () => {
    const { headers, rows, totals } = exportLessonRows('csv')
    exportCSV('school-lessons', headers, [...rows, totals])
  }

  const exportLessonsPDF = async () => {
    setPdfExporting(true)
    try {
      const { headers, rows, totals, kinds, right } = exportLessonRows('pdf')
      const columns: ExportColumn[] = headers.map((header, i) => ({ header, key: String(i) }))
      const keyed = (cells: (string | number)[]): ExportRow => Object.fromEntries(cells.map((v, i) => [String(i), v]))
      const align: Record<string, 'right'> = {}
      right.forEach((isRight, i) => { if (isRight) align[String(i)] = 'right' })
      const caption = [
        filterFrom && `${t('filterFrom')}: ${formatDate(filterFrom)}`,
        filterTo && `${t('filterTo')}: ${formatDate(filterTo)}`,
        t('lessonCount', { count: filteredLessons.length }),
      ].filter(Boolean).join(' · ')
      await exportPDF(
        columns, rows.map(keyed), `school-lessons-${todayIso()}`, t('lessonsDetailTitle'),
        t('exportedOn', { date: formatDate(new Date().toISOString()) }),
        {
          caption,
          totals: keyed(totals),
          align,
          rowStyle: i => kinds[i] === 'total' ? { fillColor: [254, 243, 199], fontStyle: 'bold' }
            : kinds[i] === 'detail' ? { fillColor: [255, 251, 235], textColor: 120 } : undefined,
        },
      )
    } finally {
      setPdfExporting(false)
    }
  }

  const togglePin = async (key: string, frozen: boolean) => {
    setPinning(key)
    setPinError(null)
    try {
      await apiFetch('/school/reports/concurrent-groups/', { method: frozen ? 'POST' : 'DELETE', body: JSON.stringify({ key }) })
      setLessonsData(d => d && d.concurrent[key] ? { ...d, concurrent: { ...d.concurrent, [key]: { ...d.concurrent[key], frozen } } } : d)
    } catch (err) {
      // the row keeps its state and the reader is told (a refused key, a lost session, the network)
      setPinError(t('pinFailed', { status: err instanceof ApiError ? String(err.status) : '—' }))
    } finally {
      setPinning(null)
    }
  }

  function handleLessonSort(col: string) {
    if (lessonSortCol === col) setLessonSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setLessonSortCol(col); setLessonSortDir('asc') }
  }

  const lessonKpis = useMemo(() => {
    const rows = filteredLessons
    const totalAttendance = rows.reduce((s, r) => s + r.attended, 0)
    const totalNoShows = rows.reduce((s, r) => s + r.no_shows, 0)
    const totalCancelled = rows.reduce((s, r) => s + r.cancelled, 0)
    const totalBooked = rows.reduce((s, r) => s + r.booked, 0)
    const noShowRate = totalBooked > 0 ? ((totalNoShows / totalBooked) * 100).toFixed(1) : '0.0'
    const cancellationRate = totalBooked > 0 ? ((totalCancelled / (totalBooked + totalCancelled)) * 100).toFixed(1) : '0.0'
    return { total: rows.length, totalAttendance, noShowRate, cancellationRate }
  }, [filteredLessons])

  // ── Students tab: attendance-aware filtered students ────────────────────────

  // For student filters we need attendance data — use scData if loaded, else use basic sort only
  const filteredStudents = useMemo(() => {
    if (!data) return []
    let rows = data.students.rows

    // If scData loaded and student attendance filters active, filter based on attendance
    if (scData && (sFilterFrom || sFilterTo || sFilterTeacher.length || sFilterLocation.length || sFilterRoom.length)) {
      const matchingStudentIds = new Set<string>()
      for (const sc of scData.rows) {
        const hasMatch = sc.attendance.some(a => {
          if (sFilterFrom && a.date < sFilterFrom) return false
          if (sFilterTo && a.date > sFilterTo) return false
          if (sFilterTeacher.length && !sFilterTeacher.includes(a.teacher_id ?? '')) return false
          if (sFilterLocation.length && !sFilterLocation.includes(a.location_id ?? '')) return false
          if (sFilterRoom.length && !sFilterRoom.includes(a.room_id ?? '')) return false
          return true
        })
        if (hasMatch) matchingStudentIds.add(sc.student_id)
      }
      rows = rows.filter(r => matchingStudentIds.has(r.id))
    }

    const within = (v: number, min: string, max: string) =>
      (min === '' || v >= Number(min)) && (max === '' || v <= Number(max))
    rows = rows.filter(r =>
      within(r.lessons_used, sUsedMin, sUsedMax) &&
      within(r.lessons_total, sTotalMin, sTotalMax) &&
      // a last attendance range leaves out who never came
      (!(sLastFrom || sLastTo) || (r.last_attendance !== '—' &&
        (!sLastFrom || r.last_attendance >= sLastFrom) && (!sLastTo || r.last_attendance <= sLastTo))))

    return [...rows].sort((a, b) => {
      const av = a[studentSortCol as keyof StudentRow]
      const bv = b[studentSortCol as keyof StudentRow]
      const cmp = String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true })
      return studentSortDir === 'asc' ? cmp : -cmp
    })
  }, [data, scData, sFilterFrom, sFilterTo, sFilterTeacher, sFilterLocation, sFilterRoom, sUsedMin, sUsedMax, sTotalMin, sTotalMax, sLastFrom, sLastTo, studentSortCol, studentSortDir])

  function handleStudentSort(col: string) {
    if (studentSortCol === col) setStudentSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setStudentSortCol(col); setStudentSortDir('asc') }
  }

  const studentKpis = useMemo(() => {
    if (!data) return { total: 0, avg_lessons_remaining: '0', docs_expired: 0, lessons_used: 0 }
    const lessons_used = filteredStudents.reduce((s, r) => s + r.lessons_used, 0)
    return {
      total: data.students.total,
      avg_lessons_remaining: data.students.avg_lessons_remaining,
      docs_expired: data.students.docs_expired,
      lessons_used,
    }
  }, [data, filteredStudents])

  // ── Teachers ────────────────────────────────────────────────────────────────

  const filteredTeachers = useMemo(() => {
    if (!data) return []
    return [...data.teachers.rows].sort((a, b) => {
      const av = a[teacherSortCol as keyof TeacherRow]
      const bv = b[teacherSortCol as keyof TeacherRow]
      const cmp = String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true })
      return teacherSortDir === 'asc' ? cmp : -cmp
    })
  }, [data, teacherSortCol, teacherSortDir])

  function handleTeacherSort(col: string) {
    if (teacherSortCol === col) setTeacherSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setTeacherSortCol(col); setTeacherSortDir('asc') }
  }

  const inputCls = 'px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20'

  // ── Teachers tab: every number within a period, this month to date by
  // default (Carlo, 2026-09-28); refetched whenever the period changes
  const [tFrom, setTFrom] = useState(monthStartIso)
  const [tTo, setTTo] = useState(todayIso)
  const [tLoading, setTLoading] = useState(false)
  const tRequest = useRef(0)
  useEffect(() => {
    if (activeTab !== 'teachers') return
    if (tFrom && tTo && tFrom > tTo) return  // the wrong way round: keep what is shown
    const id = ++tRequest.current
    setTLoading(true)
    const q = new URLSearchParams({ tab: 'teachers' })
    if (tFrom) q.set('from', tFrom)
    if (tTo) q.set('to', tTo)
    apiFetch<Pick<ReportsData, 'teachers'>>(`/school/reports/detailed/?${q}`)
      .then(res => { if (id === tRequest.current) setData(prev => ({ ...prev, teachers: res.teachers })) })
      .catch(() => { if (id === tRequest.current) setError(t('error')) })
      .finally(() => { if (id === tRequest.current) setTLoading(false) })
  }, [activeTab, tFrom, tTo, t])

  // Load scData when switching to students tab (needed for filters)
  useEffect(() => {
    if (activeTab !== 'students' || scData || scLoading) return
    setScLoading(true)
    apiFetch<StudentClassesData>('/school/reports/student-classes/')
      .then(d => setScData(d))
      .catch(() => {/* ignore, filters just won't work */ })
      .finally(() => setScLoading(false))
  }, [activeTab, scData, scLoading])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
      </div>

      {/* Tabs */}
      {/* SCH-R3-05: `w-fit` on a flex row of five fixed-padding buttons can
          never shrink, so this strip measured ~530px and dragged the whole
          page body sideways on a 390px phone — every table below it already
          has its own `overflow-x-auto`. It scrolls inside itself now. */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit max-w-full overflow-x-auto">
        {TABS.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition shrink-0 whitespace-nowrap ${
              activeTab === tab.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {loading && <BalletLoader label={t('loading')} />}
      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-700">{error}</div>}

      {!loading && !error && (
        <>
          {/* ── Bookings Tab ────────────────────────────────────────────────── */}
          {activeTab === 'bookings' && (
            <div className="space-y-6">
              
              {bkError && <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-700">{bkError}</div>}
              {!bkError && !bkLoaded && <BalletLoader label={t('loading')} />}
              {!bkError && bkLoaded && (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
                    {[
                      { label: t('kpiBookings'), value: bkKpis.total, cls: 'text-gray-900' },
                      { label: t('bookingConfirmed'), value: bkKpis.confirmed, cls: 'text-gray-900' },
                      { label: t('bookingAttended'), value: bkKpis.attended, cls: 'text-green-700' },
                      { label: t('bookingNoShow'), value: bkKpis.noShows, cls: 'text-red-500' },
                      { label: t('bookingCancelled'), value: bkKpis.cancelled, cls: 'text-gray-500' },
                      { label: t('kpiCreditsUsed'), value: bkKpis.credits, cls: 'text-[#6B1F3A]' },
                    ].map((kpi) => (
                      <div key={kpi.label} className="bg-white rounded-xl border border-gray-100 p-5">
                        <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{kpi.label}</p>
                        <p className={`text-2xl font-bold mt-1 ${kpi.cls}`}>{kpi.value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="bg-white rounded-xl border border-gray-100 px-5 py-4">
                    <div className="flex flex-wrap gap-3 items-end">
                      <div>
                        <p className="text-xs text-gray-500 mb-1">{t('filterBookedPeriod')}</p>
                        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                          {BK_PERIODS.map(p => {
                            const active = !bkFilterFrom && !bkFilterTo && bkPeriod === p
                            return (
                              <button
                                key={p}
                                type="button"
                                onClick={() => { setBkPeriod(p); setBkFilterFrom(''); setBkFilterTo(''); setBkPage(1) }}
                                className={`px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap transition ${active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                              >
                                {t(`period_${p}`)}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">{t('filterBookedFrom')}</p>
                        <input type="date" value={bkFilterFrom} onChange={e => bkFilter(setBkFilterFrom)(e.target.value)} className={inputCls} />
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">{t('filterBookedTo')}</p>
                        <input type="date" value={bkFilterTo} onChange={e => bkFilter(setBkFilterTo)(e.target.value)} className={inputCls} />
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">{t('filterLessonFrom')}</p>
                        <input type="date" value={bkFilterLessonFrom} onChange={e => bkFilter(setBkFilterLessonFrom)(e.target.value)} className={inputCls} />
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">{t('filterLessonTo')}</p>
                        <input type="date" value={bkFilterLessonTo} onChange={e => bkFilter(setBkFilterLessonTo)(e.target.value)} className={inputCls} />
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">{t('filterStudent')}</p>
                        <MultiFilterSelect label={t('allStudents')} selected={bkFilterStudent} options={bkOptions.students} onChange={bkFilter(setBkFilterStudent)} />
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">{t('colLesson')}</p>
                        <MultiFilterSelect label={t('allLessons')} selected={bkFilterLesson} onChange={bkFilter(setBkFilterLesson)}
                          options={(bkOptions.lessons ?? []).map(o => ({ value: o.value, label: o.names ? localizedName(o.names, uiLocale, o.label) : o.label })).sort((a, b) => a.label.localeCompare(b.label))} />
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">{t('filterTeacher')}</p>
                        <MultiFilterSelect label={t('allTeachers')} selected={bkFilterTeacher} options={bkOptions.teachers} onChange={bkFilter(setBkFilterTeacher)} />
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">{t('filterLocation')}</p>
                        <MultiFilterSelect label={t('allLocations')} selected={bkFilterLocation} options={bkOptions.locations} onChange={bkFilter(setBkFilterLocation)} />
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">{t('colStatus')}</p>
                        <MultiFilterSelect label={t('allStatuses')} selected={bkFilterStatus} onChange={bkFilter(setBkFilterStatus)}
                          options={['confirmed', 'attended', 'no_show', 'cancelled'].map(v => ({ value: v, label: BOOKING_STATUS_LABELS[v] }))} />
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">{t('colSource')}</p>
                        <MultiFilterSelect label={t('allSources')} selected={bkFilterSource} onChange={bkFilter(setBkFilterSource)}
                          options={Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label }))} />
                      </div>
                      {bkHasFilters && (
                        <button
                          onClick={() => { setBkPeriod(BK_DEFAULT_PERIOD); setBkFilterFrom(''); setBkFilterTo(''); setBkFilterLessonFrom(''); setBkFilterLessonTo(''); setBkFilterStudent([]); setBkFilterTeacher([]); setBkFilterLocation([]); setBkFilterStatus([]); setBkFilterSource([]); setBkFilterLesson([]); setBkPage(1) }}
                          className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg"
                        >
                          {t('clearFilters')}
                        </button>
                      )}
                      <span className="text-xs text-gray-400 ml-auto self-center">
                        {t('bookingCount', { count: bkCount })}
                      </span>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                      <h2 className="font-semibold text-gray-900">{t('bookingsDetailTitle')}</h2>
                      {bkCount > 0 && (
                        <Tooltip align="right" text={t('exportBookingsTooltip', { count: bkCount })}>
                          <button
                            disabled={bkExporting}
                            onClick={async () => {
                              setBkExporting(true)
                              try {
                                const all = await apiFetch<BookingsPage>(`/school/reports/bookings/?${bkQuery({ export: '1' })}`)
                                exportCSV(
                                  'school-bookings',
                                  [t('colBookedAt'), t('colStudent'), t('colEmail'), t('colLesson'), t('colLessonDate'), t('colTime'), t('colTeacher'), t('colLocation'), t('colRoom'), t('colSource'), t('colLessons'), t('colStatus'), t('colCancellation'), t('colCreatedBy')],
                                  all.rows.map(r => [
                                    formatDateTime(r.booked_at), r.student_name, r.student_email, bkLessonName(r), formatDate(r.lesson_date), r.start_time.slice(0, 5),
                                    r.teacher_name, r.location_name, r.room_name, bkSourceName(r),
                                    bkLessons(r), BOOKING_STATUS_LABELS[r.status] ?? r.status,
                                    r.status === 'cancelled' ? (r.credit_refunded ? t('cancelRefunded') : t('cancelBurned')) : '',
                                    actorLabel(r.created_by),
                                  ]),
                                )
                              } catch { setBkError(t('error')) } finally { setBkExporting(false) }
                            }}
                            className="text-sm text-[#6B1F3A] border border-[#6B1F3A]/30 px-3 py-1.5 rounded-lg hover:bg-[#6B1F3A]/5 transition disabled:opacity-50"
                          >
                            {t('exportCSV')}
                          </button>
                        </Tooltip>
                      )}
                    </div>
                    {bkLoading && bkRows.length === 0 ? (
                      <BalletLoader label={t('loading')} />
                    ) : bkCount === 0 ? (
                      <div className="p-8 text-center text-sm text-gray-400">{t('noBookingsMatch')}</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-100 bg-gray-50">
                              <SortTh label={t('colBookedAt')} col="booked_at" sortCol={bkSortCol} sortDir={bkSortDir} onSort={handleBkSort} />
                              <SortTh label={t('colStudent')} col="student" sortCol={bkSortCol} sortDir={bkSortDir} onSort={handleBkSort} />
                              <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-left text-gray-400 whitespace-nowrap">{t('colLesson')}</th>
                              <SortTh label={t('colLessonDate')} col="lesson_date" sortCol={bkSortCol} sortDir={bkSortDir} onSort={handleBkSort} />
                              <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-left text-gray-400 whitespace-nowrap">{t('colTeacher')}</th>
                              <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-left text-gray-400 whitespace-nowrap">{t('colLocation')}</th>
                              <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-left text-gray-400 whitespace-nowrap">{t('colSource')}</th>
                              <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-right text-gray-400 whitespace-nowrap">{t('colLessons')}</th>
                              <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-left text-gray-400 whitespace-nowrap">{t('colStatus')}</th>
                              <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-left text-gray-400 whitespace-nowrap">{t('colCreatedBy')}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {bkRows.map((r) => (
                              <tr key={r.id} className="hover:bg-gray-50 transition">
                                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtDateTime(r.booked_at)}</td>
                                <td className="px-4 py-3">
                                  <p className="font-medium text-gray-900 whitespace-nowrap">{r.student_name}</p>
                                  <p className="text-xs text-gray-400">{r.student_email}</p>
                                </td>
                                <td className="px-4 py-3 text-gray-900 whitespace-nowrap">
                                  {/* Straight to the register of that lesson: attendance, enrol, unenrol */}
                                  <Link href={`/school/attendance/${r.lesson_id}`} title={t('openLesson')} className="hover:text-[#6B1F3A] hover:underline">
                                    {bkLessonName(r)} <span className="text-gray-300">↗</span>
                                  </Link>
                                </td>
                                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                                  {fmtLessonDate(r.lesson_date)} · {r.start_time.slice(0, 5)}–{r.end_time.slice(0, 5)}
                                  {r.lesson_status === 'cancelled' && <span className="ml-2 text-xs text-red-400">{t('statusCancelled')}</span>}
                                </td>
                                <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{r.teacher_name || '—'}</td>
                                <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                                  {r.location_name || '—'}{r.room_name && <span className="text-gray-400"> · {r.room_name}</span>}
                                </td>
                                <td className="px-4 py-3 text-xs whitespace-nowrap">
                                  {r.student_package_id ? (
                                    <button
                                      onClick={() => r.student_package_id && setUsageTarget({ studentPackageId: r.student_package_id, studentName: r.student_name })}
                                      title={t('viewUsage')}
                                      className="text-[#6B1F3A] hover:underline"
                                    >
                                      {bkSourceName(r)}
                                    </button>
                                  ) : (
                                    <span className="text-gray-500">{bkSourceName(r)}</span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-right text-gray-700 whitespace-nowrap">{bkLessons(r)}</td>
                                <td className="px-4 py-3 whitespace-nowrap">
                                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                                    r.status === 'attended' ? 'bg-green-100 text-green-700'
                                      : r.status === 'no_show' ? 'bg-red-100 text-red-600'
                                      : r.status === 'cancelled' ? 'bg-gray-100 text-gray-500'
                                      : 'bg-blue-50 text-blue-700'
                                  }`}>
                                    {BOOKING_STATUS_LABELS[r.status] ?? r.status}
                                  </span>
                                  {r.status === 'cancelled' && (
                                    <p className="text-[11px] text-gray-400 mt-1">{r.credit_refunded ? t('cancelRefunded') : t('cancelBurned')}</p>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{actorLabel(r.created_by)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {bkCount > 0 && (
                      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-t border-gray-100 text-sm text-gray-500">
                        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                          <label className="flex items-center gap-2 text-xs text-gray-400">
                            {t('rowsPerPage')}
                            <select
                              value={bkPageSize}
                              onChange={e => { setBkPageSize(Number(e.target.value)); setBkPage(1) }}
                              className="px-2 py-1 border border-gray-200 rounded-lg text-sm text-gray-600 bg-white"
                            >
                              {BK_PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
                            </select>
                          </label>
                          {bkLoading && <span className="text-gray-400">{t('loading')}…</span>}
                          <span>{t('bookingRange', { from: (bkPage - 1) * bkPageSize + 1, to: Math.min(bkPage * bkPageSize, bkCount), total: bkCount })}</span>
                        </span>
                        {bkPages > 1 && (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={bkPage <= 1}
                              onClick={() => setBkPage(p => Math.max(1, p - 1))}
                              className="px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {t('pagePrev')}
                            </button>
                            <span className="text-xs text-gray-400 whitespace-nowrap">{t('pageOf', { page: bkPage, pages: bkPages })}</span>
                            <button
                              type="button"
                              disabled={bkPage >= bkPages}
                              onClick={() => setBkPage(p => Math.min(bkPages, p + 1))}
                              className="px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {t('pageNext')}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Lessons Tab ─────────────────────────────────────────────────── */}
          {activeTab === 'lessons' && !lessonsData && !error && <BalletLoader label={t('loading')} />}
          {activeTab === 'lessons' && lessonsData && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: t('kpiTotalLessons'), value: lessonKpis.total },
                  { label: t('kpiTotalAttendance'), value: lessonKpis.totalAttendance },
                  { label: t('kpiNoShowRate'), value: `${lessonKpis.noShowRate}%` },
                  { label: t('kpiCancellationRate'), value: `${lessonKpis.cancellationRate}%` },
                ].map((kpi) => (
                  <div key={kpi.label} className="bg-white rounded-xl border border-gray-100 p-5">
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{kpi.label}</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{kpi.value}</p>
                  </div>
                ))}
              </div>

              <div className="bg-white rounded-xl border border-gray-100 px-5 py-4">
                <div className="flex flex-wrap gap-3 items-end">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">{t('filterFrom')}</p>
                    <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">{t('filterTo')}</p>
                    <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className={inputCls} />
                  </div>
                  {/* This month / last month in one click, the free dates stay (Carlo, 2026-10-31) */}
                  <div>
                    <p className="text-xs text-gray-500 mb-1">{t('filterPeriodQuick')}</p>
                    <div className="flex gap-1.5">
                      {([['thisMonth', 0], ['lastMonth', -1]] as const).map(([key, offset]) => {
                        const range = monthRangeIso(offset)
                        const active = filterFrom === range.from && filterTo === range.to
                        return (
                          <button
                            key={key}
                            type="button"
                            aria-pressed={active}
                            onClick={() => { setFilterFrom(range.from); setFilterTo(range.to) }}
                            className={`px-3 py-2 text-xs rounded-lg border transition ${active
                              ? 'bg-[#6B1F3A] text-white border-[#6B1F3A]'
                              : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                          >
                            {t(key)}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">{t('filterLessonType')}</p>
                    <MultiFilterSelect label={t('allLessonTypes')} selected={filterLessonType}
                      options={lessonTypes.map(lt => ({ value: lt.id, label: lt.name }))} onChange={setFilterLessonType} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">{t('filterTeacher')}</p>
                    <MultiFilterSelect label={t('allTeachers')} selected={filterTeacher}
                      options={teachers.map(teacher => ({ value: teacher.id, label: teacher.name }))} onChange={setFilterTeacher} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">{t('filterLocation')}</p>
                    <MultiFilterSelect label={t('allLocations')} selected={filterLocation}
                      options={locations.map(l => ({ value: l.id, label: l.name }))} onChange={v => { setFilterLocation(v); setFilterRoom([]) }} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">{t('filterRoom')}</p>
                    <MultiFilterSelect label={t('allRooms')} selected={filterRoom}
                      options={rooms.map(r => ({ value: r.id, label: r.name }))} onChange={setFilterRoom} />
                  </div>
                  {compensationPlans.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">{t('filterCompPlan')}</p>
                      <MultiFilterSelect label={t('allPlans')} selected={filterCompPlan}
                        options={compensationPlans.map(p => ({ value: p.id, label: p.name }))} onChange={setFilterCompPlan} />
                    </div>
                  )}
                  {(filterFrom || filterTo || filterTeacher.length > 0 || filterLocation.length > 0 || filterRoom.length > 0 || filterCompPlan.length > 0 || filterLessonType.length > 0) && (
                    <button
                      onClick={() => { setFilterFrom(''); setFilterTo(''); setFilterTeacher([]); setFilterLocation([]); setFilterRoom([]); setFilterCompPlan([]); setFilterLessonType([]) }}
                      className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg"
                    >
                      {t('clearFilters')}
                    </button>
                  )}
                  <span className="text-xs text-gray-400 ml-auto self-center">
                    {lLoading ? t('loading') : t('lessonCount', { count: filteredLessons.length })}
                  </span>
                </div>
                {/* The server's cap: the period holds more lessons than shown, the totals are short */}
                {!lLoading && lessonsData.truncated && (
                  <p className="mt-2 text-xs text-amber-700">{t('lessonsCapHint', { count: lessonsData.rows.length })}</p>
                )}
                {/* Future lessons: fee and revenue are estimates on the bookings so far */}
                {!lLoading && filteredLessons.some(r => r.status === 'scheduled') && (
                  <p className="mt-2 text-xs text-gray-500">{t('futureEstimateHint')}</p>
                )}
                {pinError && <p className="mt-2 text-xs text-red-600" role="alert">{pinError}</p>}
              </div>

              {/* No overflow-hidden here: the "Columns" menu drops over the table and
                  must stay whole even when the list under it is short or empty */}
              <div className="bg-white rounded-xl border border-gray-100">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
                  <h2 className="font-semibold text-gray-900">{t('lessonsDetailTitle')}</h2>
                  <div className="flex items-center gap-2">
                  <Tooltip align="right" text={t('columnsHint')}>
                    <ColumnPicker
                      label={t('columnsButton')}
                      showAllLabel={t('columnsShowAll')}
                      columns={lessonColumns.map(c => ({ key: c.key, label: c.label, locked: c.locked }))}
                      hidden={hiddenLessonCols}
                      onChange={changeHiddenLessonCols}
                      footer={t('columnsSavedNote')}
                      extraAction={lessonTableSized ? { label: t('columnsResetWidths'), onClick: () => saveLessonColWidths({}) } : undefined}
                    />
                  </Tooltip>
                  <Tooltip align="right" text={t('mergeConcurrentHint')}>
                    <button
                      type="button"
                      aria-pressed={mergeConcurrent}
                      onClick={() => changeMergeConcurrent(!mergeConcurrent)}
                      className={`text-sm px-3 py-1.5 rounded-lg border transition ${mergeConcurrent
                        ? 'bg-yellow-100 border-yellow-300 text-yellow-900 font-medium'
                        : 'border-gray-200 text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
                    >
                      {t('mergeConcurrent')}
                    </button>
                  </Tooltip>
                  {filteredLessons.length > 0 && (
                    <>
                      <Tooltip align="right" text={t('exportLessonsTooltip', { count: filteredLessons.length })}>
                        <button
                          type="button"
                          onClick={exportLessonsCSV}
                          className="text-sm text-[#6B1F3A] border border-[#6B1F3A]/30 px-3 py-1.5 rounded-lg hover:bg-[#6B1F3A]/5 transition"
                        >
                          {t('exportCSV')}
                        </button>
                      </Tooltip>
                      <Tooltip align="right" text={t('exportLessonsPdfTooltip', { count: filteredLessons.length })}>
                        <button
                          type="button"
                          onClick={exportLessonsPDF}
                          disabled={pdfExporting}
                          className="text-sm text-[#6B1F3A] border border-[#6B1F3A]/30 px-3 py-1.5 rounded-lg hover:bg-[#6B1F3A]/5 transition disabled:opacity-50"
                        >
                          {t('exportPDF')}{pdfExporting ? '…' : ''}
                        </button>
                      </Tooltip>
                    </>
                  )}
                  </div>
                </div>
                {filteredLessons.length === 0 ? (
                  lLoading ? <BalletLoader label={t('loading')} /> : <div className="p-8 text-center text-sm text-gray-400">{t('noLessonsMatch')}</div>
                ) : (
                  // The box scrolls both ways and the header + totals stay put at its top
                  <div className="overflow-auto max-h-[calc(100vh-11rem)]">
                    <table
                      className={`text-sm ${lessonTableSized ? '' : 'w-full'}`}
                      style={lessonTableSized ? { tableLayout: 'fixed', width: visibleLessonColumns.reduce((s, c) => s + lessonColWidth(c.key), 0) } : undefined}
                    >
                      <colgroup>
                        {visibleLessonColumns.map(c => <col key={c.key} style={lessonTableSized ? { width: lessonColWidth(c.key) } : undefined} />)}
                      </colgroup>
                      <thead className="sticky top-0 z-10 shadow-sm">
                        <tr className="border-b border-gray-100 bg-gray-50">
                          {visibleLessonColumns.map(c => (
                            <SortTh
                              key={c.key} label={c.label} col={c.key} sortable={!!c.sortable} right={c.right}
                              sortCol={lessonSortCol} sortDir={lessonSortDir} onSort={handleLessonSort}
                              width={lessonTableSized ? lessonColWidth(c.key) : undefined}
                              onResizeStart={startLessonColResize(c.key)}
                            />
                          ))}
                        </tr>
                        {/* Riga totali: colpo d'occhio KPI su tutte le righe filtrate */}
                        <tr className="border-b border-gray-200 bg-gray-100 text-xs font-semibold text-gray-700">
                          {visibleLessonColumns.map(c => c.total === undefined ? <td key={c.key} /> : (
                            <td key={c.key} className={`px-4 py-2 whitespace-nowrap ${c.right ? 'text-right' : ''} ${c.totalClass ?? ''}`}>{c.total}</td>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {filteredLessons.map((row) => row.details ? (
                          <Fragment key={row.id}>
                            <tr className="bg-yellow-100 hover:bg-yellow-200/60 transition font-semibold">
                              {lessonCells(row, 'total')}
                            </tr>
                            {row.details.map(d => (
                              <tr key={d.id} className="bg-yellow-50/60 hover:bg-yellow-50 transition text-gray-500">
                                {lessonCells(d, 'detail')}
                              </tr>
                            ))}
                          </Fragment>
                        ) : (
                          <tr key={row.id} className="hover:bg-gray-50 transition">
                            {lessonCells(row, 'single')}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Students Tab ─────────────────────────────────────────────────── */}
          {activeTab === 'students' && (
            <div className="space-y-6">
              {/* KPI Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: t('kpiTotalStudents'), value: studentKpis.total },
                  { label: t('kpiAvgLessonsRemaining'), value: studentKpis.avg_lessons_remaining, hint: t('hintAvgLessonsRemaining') },
                  { label: t('kpiLessonsUsed'), value: studentKpis.lessons_used, hint: t('hintKpiLessonsUsed') },
                  { label: t('kpiDocsExpired'), value: studentKpis.docs_expired, warn: studentKpis.docs_expired > 0 },
                ].map((kpi) => (
                  <div key={kpi.label} className="bg-white rounded-xl border border-gray-100 p-5">
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">
                      {kpi.label}{'hint' in kpi && kpi.hint && <InfoHint text={kpi.hint} />}
                    </p>
                    <p className={`text-2xl font-bold mt-1 ${kpi.warn ? 'text-red-600' : 'text-gray-900'}`}>{kpi.value}</p>
                  </div>
                ))}
              </div>

              {/* Filters */}
              <div className="bg-white rounded-xl border border-gray-100 px-5 py-4">
                <div className="flex flex-wrap gap-3 items-end">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">{t('filterAttendanceFrom')}<InfoHint text={t('hintAttendanceRange')} /></p>
                    <input type="date" value={sFilterFrom} onChange={e => setSFilterFrom(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">{t('filterAttendanceTo')}<InfoHint text={t('hintAttendanceRange')} /></p>
                    <input type="date" value={sFilterTo} onChange={e => setSFilterTo(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">{t('filterLastAttendanceFrom')}<InfoHint text={t('hintLastAttendanceRange')} /></p>
                    <input type="date" value={sLastFrom} onChange={e => setSLastFrom(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">{t('filterLastAttendanceTo')}<InfoHint text={t('hintLastAttendanceRange')} /></p>
                    <input type="date" value={sLastTo} onChange={e => setSLastTo(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">{t('colLessonsUsed')}<InfoHint text={t('hintLessonsUsed')} /></p>
                    <div className="flex gap-1">
                      <input type="number" min={0} placeholder={t('rangeMin')} value={sUsedMin} onChange={e => setSUsedMin(e.target.value)} className={`${inputCls} w-20`} />
                      <input type="number" min={0} placeholder={t('rangeMax')} value={sUsedMax} onChange={e => setSUsedMax(e.target.value)} className={`${inputCls} w-20`} />
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">{t('colTotalLessons')}<InfoHint text={t('hintLessonsTotal')} /></p>
                    <div className="flex gap-1">
                      <input type="number" min={0} placeholder={t('rangeMin')} value={sTotalMin} onChange={e => setSTotalMin(e.target.value)} className={`${inputCls} w-20`} />
                      <input type="number" min={0} placeholder={t('rangeMax')} value={sTotalMax} onChange={e => setSTotalMax(e.target.value)} className={`${inputCls} w-20`} />
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">{t('filterTeacher')}</p>
                    <MultiFilterSelect label={t('allTeachers')} selected={sFilterTeacher}
                      options={sTeachers.map(teacher => ({ value: teacher.id, label: teacher.name }))} onChange={setSFilterTeacher} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">{t('filterLocation')}</p>
                    <MultiFilterSelect label={t('allLocations')} selected={sFilterLocation}
                      options={sLocations.map(l => ({ value: l.id, label: l.name }))} onChange={v => { setSFilterLocation(v); setSFilterRoom([]) }} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">{t('filterRoom')}</p>
                    <MultiFilterSelect label={t('allRooms')} selected={sFilterRoom}
                      options={sRooms.map(r => ({ value: r.id, label: r.name }))} onChange={setSFilterRoom} />
                  </div>
                  {(sFilterFrom || sFilterTo || sLastFrom || sLastTo || sUsedMin || sUsedMax || sTotalMin || sTotalMax || sFilterTeacher.length > 0 || sFilterLocation.length > 0 || sFilterRoom.length > 0) && (
                    <button
                      onClick={() => { setSFilterFrom(''); setSFilterTo(''); setSLastFrom(''); setSLastTo(''); setSUsedMin(''); setSUsedMax(''); setSTotalMin(''); setSTotalMax(''); setSFilterTeacher([]); setSFilterLocation([]); setSFilterRoom([]) }}
                      className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg"
                    >
                      {t('clearFilters')}
                    </button>
                  )}
                  <span className="text-xs text-gray-400 ml-auto self-center">{t('studentCount', { count: filteredStudents.length })}</span>
                </div>
              </div>

              {/* Table */}
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h2 className="font-semibold text-gray-900">{t('studentsDetailTitle')}</h2>
                  {filteredStudents.length > 0 && (
                    <Tooltip align="right" text={t('exportStudentsTooltip', { count: filteredStudents.length })}>
                      <button
                        onClick={() => exportCSV(
                          'school-students',
                          [
                            t('colStudent'), t('colEmail'), t('colPhone'),
                            t('colTotalLessons'), t('colLessonsUsed'), t('colLessonsRemaining'),
                            t('scLessonsAttended'), t('colLastAttendance'), t('colActivePackage'),
                          ],
                          filteredStudents.map(r => [
                            r.name, r.email, r.phone,
                            r.lessons_total, r.lessons_used, r.lessons_remaining,
                            r.total_attended, formatDate(r.last_attendance),
                            r.has_active_package ? t('packageActive') : t('packageNone'),
                          ]),
                        )}
                        className="text-sm text-[#6B1F3A] border border-[#6B1F3A]/30 px-3 py-1.5 rounded-lg hover:bg-[#6B1F3A]/5 transition"
                      >
                        {t('exportCSV')}
                      </button>
                    </Tooltip>
                  )}
                </div>
                {filteredStudents.length === 0 ? (
                  <div className="p-8 text-center text-sm text-gray-400">{t('noStudents')}</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50">
                          <SortTh label={t('colStudent')} col="name" sortCol={studentSortCol} sortDir={studentSortDir} onSort={handleStudentSort} />
                          <SortTh label={t('colEmail')} col="email" sortCol={studentSortCol} sortDir={studentSortDir} onSort={handleStudentSort} />
                          <SortTh label={t('colPhone')} col="phone" sortCol={studentSortCol} sortDir={studentSortDir} onSort={handleStudentSort} />
                          <SortTh label={t('colTotalLessons')} col="lessons_total" sortCol={studentSortCol} sortDir={studentSortDir} onSort={handleStudentSort} right hint={t('hintLessonsTotal')} />
                          <SortTh label={t('colLessonsUsed')} col="lessons_used" sortCol={studentSortCol} sortDir={studentSortDir} onSort={handleStudentSort} right hint={t('hintLessonsUsed')} />
                          <SortTh label={t('colLessonsRemaining')} col="lessons_remaining" sortCol={studentSortCol} sortDir={studentSortDir} onSort={handleStudentSort} right hint={t('lessonsRemainingHint')} />
                          <SortTh label={t('scLessonsAttended')} col="total_attended" sortCol={studentSortCol} sortDir={studentSortDir} onSort={handleStudentSort} right hint={t('hintLessonsAttended')} />
                          <SortTh label={t('colLastAttendance')} col="last_attendance" sortCol={studentSortCol} sortDir={studentSortDir} onSort={handleStudentSort} hint={t('hintLastAttendance')} hintAlign="right" />
                          <SortTh label={t('colPackage')} col="has_active_package" sortCol={studentSortCol} sortDir={studentSortDir} onSort={handleStudentSort} />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {filteredStudents.map((row) => (
                          <tr key={row.id} className="hover:bg-gray-50 transition">
                            <td className="px-4 py-3 font-medium text-gray-900">{row.name}</td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              {row.email ? <a href={`mailto:${row.email}`} className="text-[#6B1F3A] hover:underline">{row.email}</a> : <span className="text-gray-400">—</span>}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              {row.phone ? <a href={`tel:${row.phone.replace(/\s+/g, '')}`} className="text-[#6B1F3A] hover:underline">{row.phone}</a> : <span className="text-gray-400">—</span>}
                            </td>
                            <td className="px-4 py-3 text-right text-gray-900 font-medium">
                              {row.lessons_total}
                              {row.lessons_partial && <span title={t('lessonsPartialHint')} className="ml-1 text-amber-500">⚠︎</span>}
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-orange-600">{row.lessons_used}</td>
                            <td className="px-4 py-3 text-right font-semibold text-[#6B1F3A]">{row.lessons_remaining}</td>
                            <td className="px-4 py-3 text-right text-gray-900 font-medium">{row.total_attended}</td>
                            <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(row.last_attendance)}</td>
                            <td className="px-4 py-3">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${row.has_active_package ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                {row.has_active_package ? t('packageActive') : t('packageNone')}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Teachers Tab ─────────────────────────────────────────────────── */}
          {activeTab === 'teachers' && (
            <div className="space-y-6">
              <div className="bg-white rounded-xl border border-gray-100 px-5 py-4">
                <div className="flex flex-wrap gap-3 items-end">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">{t('filterFrom')}</p>
                    <input type="date" value={tFrom} onChange={e => setTFrom(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">{t('filterTo')}</p>
                    <input type="date" value={tTo} onChange={e => setTTo(e.target.value)} className={inputCls} />
                  </div>
                  {(tFrom !== monthStartIso() || tTo !== todayIso()) && (
                    <button
                      onClick={() => { setTFrom(monthStartIso()); setTTo(todayIso()) }}
                      className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg"
                    >
                      {t('thisMonth')}
                    </button>
                  )}
                  {tFrom && tTo && tFrom > tTo && (
                    <span className="text-xs text-red-500 self-center">{t('periodBackwards')}</span>
                  )}
                  <span className="text-xs text-gray-400 ml-auto self-center">
                    {tLoading ? t('loading') : t('teacherCount', { count: filteredTeachers.length })}
                  </span>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h2 className="font-semibold text-gray-900">{t('teacherPerformanceTitle')}</h2>
                  {filteredTeachers.length > 0 && (
                    <Tooltip align="right" text={t('exportTeachersTooltip', { count: filteredTeachers.length })}>
                      <button
                        onClick={() => exportCSV(
                          'school-teachers',
                          [
                            t('colTeacher'), t('colLessonsMonth'), t('colStudents'),
                            t('colAttendanceRate'), `${t('colEstCompensation')} (€)`,
                          ],
                          filteredTeachers.map(r => [
                            r.name, r.lessons, r.total_students,
                            r.attendance_rate === '—' ? '—' : `${r.attendance_rate}%`,
                            r.compensation_estimate.toFixed(2),
                          ]),
                        )}
                        className="text-sm text-[#6B1F3A] border border-[#6B1F3A]/30 px-3 py-1.5 rounded-lg hover:bg-[#6B1F3A]/5 transition"
                      >
                        {t('exportCSV')}
                      </button>
                    </Tooltip>
                  )}
                </div>
                {filteredTeachers.length === 0 ? (
                  tLoading ? <BalletLoader label={t('loading')} /> : <div className="p-8 text-center text-sm text-gray-400">{t('noTeachers')}</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50">
                          <SortTh label={t('colTeacher')} col="name" sortCol={teacherSortCol} sortDir={teacherSortDir} onSort={handleTeacherSort} />
                          <SortTh label={t('colLessonsMonth')} col="lessons" sortCol={teacherSortCol} sortDir={teacherSortDir} onSort={handleTeacherSort} right />
                          <SortTh label={t('colStudents')} col="total_students" sortCol={teacherSortCol} sortDir={teacherSortDir} onSort={handleTeacherSort} right />
                          <SortTh label={t('colAttendanceRate')} col="attendance_rate" sortCol={teacherSortCol} sortDir={teacherSortDir} onSort={handleTeacherSort} right />
                          <SortTh label={t('colEstCompensation')} col="compensation_estimate" sortCol={teacherSortCol} sortDir={teacherSortDir} onSort={handleTeacherSort} right />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {filteredTeachers.map((row) => (
                          <tr key={row.id} className="hover:bg-gray-50 transition">
                            <td className="px-4 py-3 font-medium text-gray-900">{row.name}</td>
                            <td className="px-4 py-3 text-right text-gray-900 font-medium">{row.lessons}</td>
                            <td className="px-4 py-3 text-right text-gray-900">{row.total_students}</td>
                            <td className="px-4 py-3 text-right">
                              {row.attendance_rate === '—' ? <span className="text-gray-400">—</span> : (
                                <span className={`font-semibold ${parseFloat(row.attendance_rate) >= 80 ? 'text-green-700' : parseFloat(row.attendance_rate) >= 60 ? 'text-yellow-600' : 'text-red-500'}`}>
                                  {row.attendance_rate}%
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-[#6B1F3A]">
                              {row.compensation_estimate > 0 ? formatMoney(row.compensation_estimate, uiLocale) : <span className="text-gray-400 font-normal">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
          {/* ── Packages & Subscriptions Tab ─────────────────────────────── */}
          {activeTab === 'packages' && (() => {
            const rows = pkRows ?? []
            const locName = (obj: TranslatedNames): string => localizedName(obj, uiLocale, '—')
            const students = [...new Map(rows.map(r => [r.student_id, r.student_name])).entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
            const products = [...new Set(rows.map(r => locName(r.product)))].sort()
            const statuses = [...new Set(rows.map(r => r.status))]
            const statusLabel = (st: string) => t(st === 'active' ? 'pkStatusActive' : st === 'expired' ? 'pkStatusExpired' : st === 'exhausted' ? 'pkStatusExhausted' : st === 'deleted' ? 'pkStatusDeleted' : st === 'suspended' ? 'pkStatusSuspended' : st === 'grace_period' ? 'pkStatusGrace' : 'pkStatusCancelled')
            const pkDir = pkSortDir === 'asc' ? 1 : -1
            const filtered = rows.filter(r => {
              const bought = localDay(r.started_at)
              if (pkFilterFrom && bought < pkFilterFrom) return false
              if (pkFilterTo && bought > pkFilterTo) return false
              if (pkFilterExpFrom || pkFilterExpTo) {
                if (!r.ends_at) return false  // no expiry: never inside an expiry range
                const ends = localDay(r.ends_at)
                if (pkFilterExpFrom && ends < pkFilterExpFrom) return false
                if (pkFilterExpTo && ends > pkFilterExpTo) return false
              }
              if (pkFilterStudent.length && !pkFilterStudent.includes(r.student_id)) return false
              if (pkFilterProduct.length && !pkFilterProduct.includes(locName(r.product))) return false
              if (pkFilterKind.length && !pkFilterKind.includes(r.kind)) return false
              if (pkFilterStatus.length && !pkFilterStatus.includes(r.status)) return false
              return true
            }).sort((a, b) => {
              if (pkSortCol === 'student') return a.student_name.localeCompare(b.student_name) * pkDir
              if (pkSortCol === 'expires') return (a.ends_at ?? '').localeCompare(b.ends_at ?? '') * pkDir
              return (Date.parse(a.started_at) - Date.parse(b.started_at)) * pkDir
            })
            const pkHasFilters = Boolean(pkFilterFrom || pkFilterTo || pkFilterExpFrom || pkFilterExpTo) || pkFilterStudent.length > 0 || pkFilterProduct.length > 0
              || pkFilterKind.length > 0 || pkFilterStatus.length > 0
            return (
              <div className="space-y-4">
                {/* Filters */}
                <div className="bg-white rounded-xl border border-gray-100 px-5 py-4">
                  <div className="flex flex-wrap gap-3 items-end">
                    <div>
                      <p className="text-xs text-gray-500 mb-1">{t('filterPurchasedFrom')}</p>
                      <input type="date" value={pkFilterFrom} onChange={e => setPkFilterFrom(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">{t('filterPurchasedTo')}</p>
                      <input type="date" value={pkFilterTo} onChange={e => setPkFilterTo(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">{t('filterExpiresFrom')}</p>
                      <input type="date" value={pkFilterExpFrom} onChange={e => setPkFilterExpFrom(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">{t('filterExpiresTo')}</p>
                      <input type="date" value={pkFilterExpTo} onChange={e => setPkFilterExpTo(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">{t('colStudent')}</p>
                      <MultiFilterSelect label={t('allStudents')} selected={pkFilterStudent}
                        options={students.map(st => ({ value: st.id, label: st.name }))} onChange={setPkFilterStudent} />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">{t('colProduct')}</p>
                      <MultiFilterSelect label={t('allProducts')} selected={pkFilterProduct}
                        options={products.map(n => ({ value: n, label: n }))} onChange={setPkFilterProduct} />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">{t('colKind')}</p>
                      <MultiFilterSelect label={t('allKinds')} selected={pkFilterKind}
                        options={[{ value: 'package', label: t('kindPackage') }, { value: 'subscription', label: t('kindSubscription') }]} onChange={setPkFilterKind} />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">{t('colStatus2')}</p>
                      <MultiFilterSelect label={t('allStatuses')} selected={pkFilterStatus}
                        options={statuses.map(st => ({ value: st, label: statusLabel(st) }))} onChange={setPkFilterStatus} />
                    </div>
                    {pkHasFilters && (
                      <button
                        onClick={() => { setPkFilterFrom(''); setPkFilterTo(''); setPkFilterExpFrom(''); setPkFilterExpTo(''); setPkFilterStudent([]); setPkFilterProduct([]); setPkFilterKind([]); setPkFilterStatus([]) }}
                        className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg"
                      >
                        {t('clearFilters')}
                      </button>
                    )}
                    <span className="text-xs text-gray-400 ml-auto self-center">{t('rowCount', { count: filtered.length })}</span>
                  </div>
                </div>

                {/* Table */}
                <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
                  {pkLoading ? (
                    <BalletLoader label={t('loading')} />
                  ) : filtered.length === 0 ? (
                    <div className="p-8 text-center text-sm text-gray-400">—</div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50">
                          <SortTh label={t('colStudent')} col="student" sortCol={pkSortCol} sortDir={pkSortDir} onSort={handlePkSort} />
                          {[t('colProduct'), t('colKind'), t('colUsage')].map((h) => (
                            <th key={h} className="text-left px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide whitespace-nowrap">{h}</th>
                          ))}
                          <SortTh label={t('colPurchased')} col="purchased" sortCol={pkSortCol} sortDir={pkSortDir} onSort={handlePkSort} />
                          <SortTh label={t('colExpiry')} col="expires" sortCol={pkSortCol} sortDir={pkSortDir} onSort={handlePkSort} />
                          <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide whitespace-nowrap">{t('colStatus2')}</th>
                          <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide whitespace-nowrap">{t('colAssignedBy')}</th>
                          <th />

                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {filtered.map(r => {
                          const used = r.total != null && r.remaining != null ? r.total - r.remaining : null
                          return (
                            <tr key={`${r.kind}-${r.id}`}
                              className={`hover:bg-gray-50 transition ${r.kind === 'package' ? 'cursor-pointer' : ''}`}
                              onClick={r.kind === 'package' ? () => setUsageTarget({ studentPackageId: r.id, studentName: r.student_name }) : undefined}>
                              <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{r.student_name}</td>
                              <td className="px-4 py-3 text-gray-700">{locName(r.product)}</td>
                              <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{r.kind === 'package' ? t('kindPackage') : t('kindSubscription')}</td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                {r.total == null ? (
                                  <span className="text-gray-500">{t('usageUnlimited')}</span>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <div className="w-20 h-1.5 bg-gray-200 rounded-full overflow-hidden shrink-0">
                                      <div className="h-full bg-[#6B1F3A] rounded-full" style={{ width: `${r.total > 0 ? Math.round((used! / r.total) * 100) : 0}%` }} />
                                    </div>
                                    <span className="text-xs text-gray-500">
                                      {r.lessons_total != null && r.lessons_remaining != null
                                        ? t('usageLessons', { used: r.lessons_total - r.lessons_remaining, total: r.lessons_total })
                                        : t(r.kind === 'package' ? 'usageCredits' : 'usageAccesses', { used: used!, total: r.total })}
                                    </span>
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{fmtDay(r.started_at)}</td>
                              <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{r.ends_at ? fmtDay(r.ends_at) : '—'}</td>
                              <td className="px-4 py-3">
                                <span className={`text-xs px-2 py-0.5 rounded-full ${r.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                  {statusLabel(r.status)}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{actorLabel(r.assigned_by)}</td>
                              <td className="px-4 py-3 text-right">
                                {r.kind === 'package' && <span className="text-xs text-[#6B1F3A] whitespace-nowrap">{t('viewUsage')} →</span>}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>

              </div>
            )
          })()}
        </>
      )}

      {/* One package's usage: the Students page's component, in package mode */}
      {usageTarget && (
        <StudentUsageModal
          studentPackageId={usageTarget.studentPackageId}
          studentName={usageTarget.studentName}
          onClose={() => setUsageTarget(null)}
          onChanged={() => setPkRows(null)}  // the Packages tab refetches when its rows are null
        />
      )}
    </div>
  )
}
