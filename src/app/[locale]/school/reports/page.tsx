'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import Tooltip from '@/components/ui/Tooltip'
import MultiFilterSelect from '@/components/ui/MultiFilterSelect'

// ── Types ─────────────────────────────────────────────────────────────────────

type LessonRow = {
  id: string
  name: string
  date: string
  teacher: string
  teacher_id: string | null
  room: string
  room_id: string | null
  room_cost: number | null
  location: string
  location_id: string | null
  compensation_plan: string
  compensation_plan_id: string | null
  capacity: number
  booked: number
  attended: number
  no_shows: number
  cancelled: number
  status: string
}

type StudentRow = {
  id: string
  name: string
  credits_remaining: number
  credits_burned: number
  last_attendance: string
  total_attended: number
  has_active_package: boolean
}

type TeacherRow = {
  id: string
  name: string
  lessons_this_month: number
  total_students: number
  attendance_rate: string
  compensation_estimate: number
}

type ReportsData = {
  lessons: { rows: LessonRow[] }
  students: { total: number; avg_credits: string; docs_expired: number; rows: StudentRow[] }
  teachers: { rows: TeacherRow[] }
}

type AttRow = {
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

type SortDir = 'asc' | 'desc'

// ── CSV helpers ───────────────────────────────────────────────────────────────

function downloadCSV(rows: Record<string, unknown>[], filename: string) {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const lines = rows.map((r) =>
    headers.map((h) => {
      const val = r[h]
      const str = val === null || val === undefined ? '' : String(val)
      return str.includes(',') ? `"${str}"` : str
    }).join(',')
  )
  const blob = new Blob([[headers.join(','), ...lines].join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

type Tab = 'lessons' | 'students' | 'student-classes' | 'teachers'

function SortTh({ label, col, sortCol, sortDir, onSort, right }: {
  label: string; col: string; sortCol: string; sortDir: SortDir
  onSort: (col: string) => void; right?: boolean
}) {
  const active = sortCol === col
  return (
    <th
      onClick={() => onSort(col)}
      className={`px-4 py-3 text-xs font-medium uppercase tracking-wide cursor-pointer select-none whitespace-nowrap ${right ? 'text-right' : 'text-left'} ${active ? 'text-gray-700' : 'text-gray-400'} hover:text-gray-600`}
    >
      {label} {active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </th>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SchoolReportsPage() {
  const t = useTranslations('school.reports')
  const uiLocale = useLocale()

  const TABS: { id: Tab; label: string }[] = [
    { id: 'lessons', label: t('tabLessons') },
    { id: 'students', label: t('tabStudents') },
    { id: 'student-classes', label: t('tabStudentClasses') },
    { id: 'teachers', label: t('tabTeachers') },
  ]

  const [activeTab, setActiveTab] = useState<Tab>('lessons')
  const [data, setData] = useState<ReportsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Student Classes data (lazy loaded)
  const [scData, setScData] = useState<StudentClassesData | null>(null)
  const [scLoading, setScLoading] = useState(false)
  const [scError, setScError] = useState<string | null>(null)

  // Lesson filters
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [filterTeacher, setFilterTeacher] = useState<string[]>([])
  const [filterLocation, setFilterLocation] = useState<string[]>([])
  const [filterRoom, setFilterRoom] = useState<string[]>([])
  const [filterCompPlan, setFilterCompPlan] = useState<string[]>([])

  // Student filters
  const [sFilterFrom, setSFilterFrom] = useState('')
  const [sFilterTo, setSFilterTo] = useState('')
  const [sFilterTeacher, setSFilterTeacher] = useState<string[]>([])
  const [sFilterLocation, setSFilterLocation] = useState<string[]>([])
  const [sFilterRoom, setSFilterRoom] = useState<string[]>([])

  // Student Classes filters
  const [scFilterStudent, setScFilterStudent] = useState<string[]>([])
  const [scFilterFrom, setScFilterFrom] = useState('')
  const [scFilterTo, setScFilterTo] = useState('')
  const [scFilterTeacher, setScFilterTeacher] = useState<string[]>([])
  const [scFilterLocation, setScFilterLocation] = useState<string[]>([])
  const [scFilterRoom, setScFilterRoom] = useState<string[]>([])
  const [scExpandedStudent, setScExpandedStudent] = useState<string | null>(null)

  // Lesson sort
  const [lessonSortCol, setLessonSortCol] = useState('date')
  const [lessonSortDir, setLessonSortDir] = useState<SortDir>('desc')

  // Student sort
  const [studentSortCol, setStudentSortCol] = useState('name')
  const [studentSortDir, setStudentSortDir] = useState<SortDir>('asc')

  // Teacher sort
  const [teacherSortCol, setTeacherSortCol] = useState('name')
  const [teacherSortDir, setTeacherSortDir] = useState<SortDir>('asc')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/school/reports', { cache: 'no-store' })
      if (!res.ok) { setError(t('error')); return }
      setData(await res.json())
    } catch { setError(t('error')) }
    finally { setLoading(false) }
  }, [t])

  useEffect(() => { load() }, [load])

  // Lazy load student-classes tab
  useEffect(() => {
    if (activeTab !== 'student-classes' || scData || scLoading) return
    setScLoading(true)
    fetch('/api/school/reports/student-classes', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setScData(d))
      .catch(() => setScError(t('error')))
      .finally(() => setScLoading(false))
  }, [activeTab, scData, scLoading, t])

  // ── Derived filter options from lessons ──────────────────────────────────────

  const teachers = useMemo(() => {
    if (!data) return []
    const seen = new Set<string>()
    return data.lessons.rows
      .filter(r => r.teacher !== '—' && r.teacher_id && !seen.has(r.teacher_id) && seen.add(r.teacher_id))
      .map(r => ({ id: r.teacher_id!, name: r.teacher }))
  }, [data])

  const locations = useMemo(() => {
    if (!data) return []
    const seen = new Set<string>()
    return data.lessons.rows
      .filter(r => r.location !== '—' && r.location_id && !seen.has(r.location_id) && seen.add(r.location_id))
      .map(r => ({ id: r.location_id!, name: r.location }))
  }, [data])

  const rooms = useMemo(() => {
    if (!data) return []
    const seen = new Set<string>()
    return data.lessons.rows
      .filter(r => r.room !== '—' && r.room_id &&
        (filterLocation.length === 0 || filterLocation.includes(r.location_id ?? '')) &&
        !seen.has(r.room_id) && seen.add(r.room_id))
      .map(r => ({ id: r.room_id!, name: r.room }))
  }, [data, filterLocation])

  const compensationPlans = useMemo(() => {
    if (!data) return []
    const seen = new Set<string>()
    return data.lessons.rows
      .filter(r => r.compensation_plan !== '—' && r.compensation_plan_id && !seen.has(r.compensation_plan_id) && seen.add(r.compensation_plan_id))
      .map(r => ({ id: r.compensation_plan_id!, name: r.compensation_plan }))
  }, [data])

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

  const filteredLessons = useMemo(() => {
    if (!data) return []
    let rows = data.lessons.rows
    if (filterFrom) rows = rows.filter(r => r.date >= filterFrom)
    if (filterTo) rows = rows.filter(r => r.date <= filterTo)
    if (filterTeacher.length) rows = rows.filter(r => filterTeacher.includes(r.teacher_id ?? ''))
    if (filterLocation.length) rows = rows.filter(r => filterLocation.includes(r.location_id ?? ''))
    if (filterRoom.length) rows = rows.filter(r => filterRoom.includes(r.room_id ?? ''))
    if (filterCompPlan.length) rows = rows.filter(r => filterCompPlan.includes(r.compensation_plan_id ?? ''))
    return [...rows].sort((a, b) => {
      const av = a[lessonSortCol as keyof LessonRow]
      const bv = b[lessonSortCol as keyof LessonRow]
      if (av === null || av === undefined) return 1
      if (bv === null || bv === undefined) return -1
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true })
      return lessonSortDir === 'asc' ? cmp : -cmp
    })
  }, [data, filterFrom, filterTo, filterTeacher, filterLocation, filterRoom, filterCompPlan, lessonSortCol, lessonSortDir])

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

    return [...rows].sort((a, b) => {
      const av = a[studentSortCol as keyof StudentRow]
      const bv = b[studentSortCol as keyof StudentRow]
      const cmp = String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true })
      return studentSortDir === 'asc' ? cmp : -cmp
    })
  }, [data, scData, sFilterFrom, sFilterTo, sFilterTeacher, sFilterLocation, sFilterRoom, studentSortCol, studentSortDir])

  function handleStudentSort(col: string) {
    if (studentSortCol === col) setStudentSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setStudentSortCol(col); setStudentSortDir('asc') }
  }

  const studentKpis = useMemo(() => {
    if (!data) return { total: 0, avg_credits: '0', docs_expired: 0, total_burned: 0 }
    const rows = filteredStudents
    const total_burned = rows.reduce((s, r) => s + r.credits_burned, 0)
    return {
      total: data.students.total,
      avg_credits: data.students.avg_credits,
      docs_expired: data.students.docs_expired,
      total_burned,
    }
  }, [data, filteredStudents])

  // ── Student Classes tab ─────────────────────────────────────────────────────

  const scTeachers = useMemo(() => {
    if (!scData) return []
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
  }, [scData])

  const scLocations = useMemo(() => {
    if (!scData) return []
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
  }, [scData])

  const scRooms = useMemo(() => {
    if (!scData) return []
    const seen = new Set<string>()
    const result: { id: string; name: string }[] = []
    for (const s of scData.rows) {
      for (const a of s.attendance) {
        if (a.room_id && (scFilterLocation.length === 0 || scFilterLocation.includes(a.location_id ?? '')) && !seen.has(a.room_id)) {
          seen.add(a.room_id)
          result.push({ id: a.room_id, name: a.room_name })
        }
      }
    }
    return result
  }, [scData, scFilterLocation])

  const scStudentNames = useMemo(() => {
    if (!scData) return []
    return scData.rows.map(r => ({ id: r.student_id, name: r.student_name }))
  }, [scData])

  const filteredScRows = useMemo(() => {
    if (!scData) return []
    let rows = scData.rows
    if (scFilterStudent.length) rows = rows.filter(r => scFilterStudent.includes(r.student_id))
    rows = rows.map(r => ({
      ...r,
      attendance: r.attendance.filter(a => {
        if (scFilterFrom && a.date < scFilterFrom) return false
        if (scFilterTo && a.date > scFilterTo) return false
        if (scFilterTeacher.length && !scFilterTeacher.includes(a.teacher_id ?? '')) return false
        if (scFilterLocation.length && !scFilterLocation.includes(a.location_id ?? '')) return false
        if (scFilterRoom.length && !scFilterRoom.includes(a.room_id ?? '')) return false
        return true
      }),
    })).filter(r => r.attendance.length > 0 || scFilterStudent.length === 0)
    return rows
  }, [scData, scFilterStudent, scFilterFrom, scFilterTo, scFilterTeacher, scFilterLocation, scFilterRoom])

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

  // Load scData when switching to students tab (needed for filters)
  useEffect(() => {
    if (activeTab !== 'students' || scData || scLoading) return
    setScLoading(true)
    fetch('/api/school/reports/student-classes', { cache: 'no-store' })
      .then(r => r.json())
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
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit">
        {TABS.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition ${
              activeTab === tab.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {loading && <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400 text-sm">{t('loading')}</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-700">{error}</div>}

      {!loading && !error && data && (
        <>
          {/* ── Lessons Tab ─────────────────────────────────────────────────── */}
          {activeTab === 'lessons' && (
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
                  {(filterFrom || filterTo || filterTeacher.length > 0 || filterLocation.length > 0 || filterRoom.length > 0 || filterCompPlan.length > 0) && (
                    <button
                      onClick={() => { setFilterFrom(''); setFilterTo(''); setFilterTeacher([]); setFilterLocation([]); setFilterRoom([]); setFilterCompPlan([]) }}
                      className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg"
                    >
                      {t('clearFilters')}
                    </button>
                  )}
                  <span className="text-xs text-gray-400 ml-auto self-center">{t('lessonCount', { count: filteredLessons.length })}</span>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h2 className="font-semibold text-gray-900">{t('lessonsDetailTitle')}</h2>
                  {filteredLessons.length > 0 && (
                    <Tooltip align="right" text={t('exportLessonsTooltip', { count: filteredLessons.length })}>
                      <button
                        onClick={() => downloadCSV(
                          filteredLessons.map(r => ({
                            Name: r.name, Date: r.date, Teacher: r.teacher,
                            Location: r.location, Room: r.room,
                            'Room Cost (€)': r.room_cost !== null ? Number(r.room_cost).toFixed(2) : '—',
                            'Comp. Plan': r.compensation_plan,
                            Capacity: r.capacity, Booked: r.booked,
                            Attended: r.attended, 'No Shows': r.no_shows,
                            Cancelled: r.cancelled, Status: r.status,
                          })),
                          `school-lessons-${new Date().toISOString().slice(0, 10)}.csv`
                        )}
                        className="text-sm text-[#6B1F3A] border border-[#6B1F3A]/30 px-3 py-1.5 rounded-lg hover:bg-[#6B1F3A]/5 transition"
                      >
                        {t('exportCSV')}
                      </button>
                    </Tooltip>
                  )}
                </div>
                {filteredLessons.length === 0 ? (
                  <div className="p-8 text-center text-sm text-gray-400">{t('noLessonsMatch')}</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50">
                          <SortTh label={t('colLesson')} col="name" sortCol={lessonSortCol} sortDir={lessonSortDir} onSort={handleLessonSort} />
                          <SortTh label={t('colDate')} col="date" sortCol={lessonSortCol} sortDir={lessonSortDir} onSort={handleLessonSort} />
                          <SortTh label={t('colTeacher')} col="teacher" sortCol={lessonSortCol} sortDir={lessonSortDir} onSort={handleLessonSort} />
                          <SortTh label={t('colLocation')} col="location" sortCol={lessonSortCol} sortDir={lessonSortDir} onSort={handleLessonSort} />
                          <SortTh label={t('colRoom')} col="room" sortCol={lessonSortCol} sortDir={lessonSortDir} onSort={handleLessonSort} />
                          <SortTh label={t('colRoomCost')} col="room_cost" sortCol={lessonSortCol} sortDir={lessonSortDir} onSort={handleLessonSort} right />
                          <SortTh label={t('colCompPlan')} col="compensation_plan" sortCol={lessonSortCol} sortDir={lessonSortDir} onSort={handleLessonSort} />
                          <SortTh label={t('colCapacity')} col="capacity" sortCol={lessonSortCol} sortDir={lessonSortDir} onSort={handleLessonSort} right />
                          <SortTh label={t('colBooked')} col="booked" sortCol={lessonSortCol} sortDir={lessonSortDir} onSort={handleLessonSort} right />
                          <SortTh label={t('colAttended')} col="attended" sortCol={lessonSortCol} sortDir={lessonSortDir} onSort={handleLessonSort} right />
                          <SortTh label={t('colNoShows')} col="no_shows" sortCol={lessonSortCol} sortDir={lessonSortDir} onSort={handleLessonSort} right />
                          <SortTh label={t('colStatus')} col="status" sortCol={lessonSortCol} sortDir={lessonSortDir} onSort={handleLessonSort} />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {filteredLessons.map((row) => (
                          <tr key={row.id} className="hover:bg-gray-50 transition">
                            <td className="px-4 py-3 font-medium text-gray-900">{row.name}</td>
                            <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                              {new Date(row.date).toLocaleDateString(uiLocale, { day: '2-digit', month: 'short', year: 'numeric' })}
                            </td>
                            <td className="px-4 py-3 text-gray-600">{row.teacher}</td>
                            <td className="px-4 py-3 text-gray-500 text-xs">{row.location}</td>
                            <td className="px-4 py-3 text-gray-500 text-xs">{row.room}</td>
                            <td className="px-4 py-3 text-right text-gray-500 text-xs">
                              {row.room_cost !== null ? `€${Number(row.room_cost).toFixed(2)}` : '—'}
                            </td>
                            <td className="px-4 py-3 text-gray-500 text-xs">{row.compensation_plan}</td>
                            <td className="px-4 py-3 text-right text-gray-900">{row.capacity}</td>
                            <td className="px-4 py-3 text-right text-gray-900">{row.booked}</td>
                            <td className="px-4 py-3 text-right font-semibold text-green-700">{row.attended}</td>
                            <td className="px-4 py-3 text-right font-semibold text-red-500">{row.no_shows}</td>
                            <td className="px-4 py-3">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${
                                row.status === 'completed' ? 'bg-green-100 text-green-700' :
                                row.status === 'cancelled' ? 'bg-red-100 text-red-600' :
                                'bg-blue-100 text-blue-700'
                              }`}>{row.status}</span>
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

          {/* ── Students Tab ─────────────────────────────────────────────────── */}
          {activeTab === 'students' && (
            <div className="space-y-6">
              {/* KPI Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: t('kpiTotalStudents'), value: studentKpis.total },
                  { label: t('kpiAvgCredits'), value: studentKpis.avg_credits },
                  { label: t('kpiCreditsBurned'), value: studentKpis.total_burned },
                  { label: t('kpiDocsExpired'), value: studentKpis.docs_expired, warn: studentKpis.docs_expired > 0 },
                ].map((kpi) => (
                  <div key={kpi.label} className="bg-white rounded-xl border border-gray-100 p-5">
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{kpi.label}</p>
                    <p className={`text-2xl font-bold mt-1 ${kpi.warn ? 'text-red-600' : 'text-gray-900'}`}>{kpi.value}</p>
                  </div>
                ))}
              </div>

              {/* Filters */}
              <div className="bg-white rounded-xl border border-gray-100 px-5 py-4">
                <div className="flex flex-wrap gap-3 items-end">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">{t('filterFrom')}</p>
                    <input type="date" value={sFilterFrom} onChange={e => setSFilterFrom(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">{t('filterTo')}</p>
                    <input type="date" value={sFilterTo} onChange={e => setSFilterTo(e.target.value)} className={inputCls} />
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
                  {(sFilterFrom || sFilterTo || sFilterTeacher.length > 0 || sFilterLocation.length > 0 || sFilterRoom.length > 0) && (
                    <button
                      onClick={() => { setSFilterFrom(''); setSFilterTo(''); setSFilterTeacher([]); setSFilterLocation([]); setSFilterRoom([]) }}
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
                        onClick={() => downloadCSV(
                          filteredStudents.map(r => ({
                            Name: r.name,
                            'Credits Remaining': r.credits_remaining,
                            'Credits Burned': r.credits_burned,
                            'Last Attendance': r.last_attendance,
                            'Total Attended': r.total_attended,
                            'Active Package': r.has_active_package ? 'Yes' : 'No',
                          })),
                          `school-students-${new Date().toISOString().slice(0, 10)}.csv`
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
                          <SortTh label={t('colCredits')} col="credits_remaining" sortCol={studentSortCol} sortDir={studentSortDir} onSort={handleStudentSort} right />
                          <SortTh label={t('colCreditsBurned')} col="credits_burned" sortCol={studentSortCol} sortDir={studentSortDir} onSort={handleStudentSort} right />
                          <SortTh label={t('colLastAttendance')} col="last_attendance" sortCol={studentSortCol} sortDir={studentSortDir} onSort={handleStudentSort} />
                          <SortTh label={t('colTotalLessons')} col="total_attended" sortCol={studentSortCol} sortDir={studentSortDir} onSort={handleStudentSort} right />
                          <SortTh label={t('colPackage')} col="has_active_package" sortCol={studentSortCol} sortDir={studentSortDir} onSort={handleStudentSort} />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {filteredStudents.map((row) => (
                          <tr key={row.id} className="hover:bg-gray-50 transition">
                            <td className="px-4 py-3 font-medium text-gray-900">{row.name}</td>
                            <td className="px-4 py-3 text-right font-semibold text-[#6B1F3A]">{row.credits_remaining}</td>
                            <td className="px-4 py-3 text-right font-semibold text-orange-600">{row.credits_burned}</td>
                            <td className="px-4 py-3 text-gray-500">{row.last_attendance}</td>
                            <td className="px-4 py-3 text-right text-gray-900 font-medium">{row.total_attended}</td>
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

          {/* ── Student Classes Tab ──────────────────────────────────────────── */}
          {activeTab === 'student-classes' && (
            <div className="space-y-6">
              {scLoading && <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400 text-sm">{t('loading')}</div>}
              {scError && <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-700">{scError}</div>}
              {!scLoading && !scError && scData && (
                <>
                  {/* Filters */}
                  <div className="bg-white rounded-xl border border-gray-100 px-5 py-4">
                    <div className="flex flex-wrap gap-3 items-end">
                      <div>
                        <p className="text-xs text-gray-500 mb-1">{t('filterStudent')}</p>
                        <MultiFilterSelect label={t('allStudents')} selected={scFilterStudent}
                          options={scStudentNames.map(s => ({ value: s.id, label: s.name }))} onChange={setScFilterStudent} />
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">{t('filterFrom')}</p>
                        <input type="date" value={scFilterFrom} onChange={e => setScFilterFrom(e.target.value)} className={inputCls} />
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">{t('filterTo')}</p>
                        <input type="date" value={scFilterTo} onChange={e => setScFilterTo(e.target.value)} className={inputCls} />
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">{t('filterTeacher')}</p>
                        <MultiFilterSelect label={t('allTeachers')} selected={scFilterTeacher}
                          options={scTeachers.map(t2 => ({ value: t2.id, label: t2.name }))} onChange={setScFilterTeacher} />
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">{t('filterLocation')}</p>
                        <MultiFilterSelect label={t('allLocations')} selected={scFilterLocation}
                          options={scLocations.map(l => ({ value: l.id, label: l.name }))} onChange={v => { setScFilterLocation(v); setScFilterRoom([]) }} />
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">{t('filterRoom')}</p>
                        <MultiFilterSelect label={t('allRooms')} selected={scFilterRoom}
                          options={scRooms.map(r => ({ value: r.id, label: r.name }))} onChange={setScFilterRoom} />
                      </div>
                      {(scFilterStudent.length > 0 || scFilterFrom || scFilterTo || scFilterTeacher.length > 0 || scFilterLocation.length > 0 || scFilterRoom.length > 0) && (
                        <button
                          onClick={() => { setScFilterStudent([]); setScFilterFrom(''); setScFilterTo(''); setScFilterTeacher([]); setScFilterLocation([]); setScFilterRoom([]) }}
                          className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg"
                        >
                          {t('clearFilters')}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Student cards */}
                  <div className="space-y-4">
                    {filteredScRows.length === 0 ? (
                      <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">{t('noStudents')}</div>
                    ) : filteredScRows.map((sc) => {
                      const isExpanded = scExpandedStudent === sc.student_id
                      const totalBurned = sc.attendance.filter(a => a.status === 'present').reduce((s, a) => s + a.credits_deducted, 0)
                      const totalPresent = sc.attendance.filter(a => a.status === 'present').length
                      const totalNoShow = sc.attendance.filter(a => a.status === 'no_show').length
                      const activePackages = sc.packages.filter(p => p.status === 'active')

                      return (
                        <div key={sc.student_id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                          {/* Student header row */}
                          <button
                            onClick={() => setScExpandedStudent(isExpanded ? null : sc.student_id)}
                            className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition text-left"
                          >
                            <div className="flex items-center gap-4">
                              <span className="font-semibold text-gray-900">{sc.student_name}</span>
                              <span className="text-xs text-gray-400">{t('scLessonsAttended', { count: totalPresent })}</span>
                              {totalNoShow > 0 && (
                                <span className="text-xs text-red-400">{t('scNoShows', { count: totalNoShow })}</span>
                              )}
                              {totalBurned > 0 && (
                                <span className="text-xs text-orange-600 font-medium">{t('scCreditsBurned', { count: totalBurned })}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-4">
                              {activePackages.length > 0 && (
                                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                                  {t('scActivePackages', { count: activePackages.length })}
                                </span>
                              )}
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
                                className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                                <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                              </svg>
                            </div>
                          </button>

                          {isExpanded && (
                            <div className="border-t border-gray-100">
                              {/* Packages */}
                              {sc.packages.length > 0 && (
                                <div className="px-6 py-4 border-b border-gray-50 bg-gray-50/50">
                                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">{t('scPackagesTitle')}</p>
                                  <div className="flex flex-wrap gap-3">
                                    {sc.packages.map(pkg => (
                                      <div key={pkg.id} className={`text-xs px-3 py-2 rounded-lg border ${pkg.status === 'active' ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-white'}`}>
                                        <span className={`font-medium ${pkg.status === 'active' ? 'text-green-700' : 'text-gray-500'}`}>
                                          {pkg.credits_remaining}/{pkg.credits_total} {t('colCredits')}
                                        </span>
                                        {pkg.expires_at && (
                                          <span className="text-gray-400 ml-2">
                                            {t('scExpires')} {new Date(pkg.expires_at).toLocaleDateString(uiLocale, { day: '2-digit', month: 'short', year: 'numeric' })}
                                          </span>
                                        )}
                                        <span className={`ml-2 px-1.5 py-0.5 rounded-full ${pkg.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                          {pkg.status}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Attendance table */}
                              {sc.attendance.length === 0 ? (
                                <div className="px-6 py-4 text-sm text-gray-400">{t('scNoAttendance')}</div>
                              ) : (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="border-b border-gray-100 bg-gray-50">
                                        <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-left text-gray-400">{t('colDate')}</th>
                                        <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-left text-gray-400">{t('colLesson')}</th>
                                        <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-left text-gray-400">{t('colTeacher')}</th>
                                        <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-left text-gray-400">{t('colLocation')}</th>
                                        <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-left text-gray-400">{t('colRoom')}</th>
                                        <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-right text-gray-400">{t('colCreditsBurned')}</th>
                                        <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-left text-gray-400">{t('colSource')}</th>
                                        <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-left text-gray-400">{t('colStatus')}</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                      {sc.attendance.map((a, i) => (
                                        <tr key={i} className="hover:bg-gray-50 transition">
                                          <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                                            {new Date(a.date).toLocaleDateString(uiLocale, { day: '2-digit', month: 'short', year: 'numeric' })}
                                            {a.start_time && <span className="text-xs text-gray-400 ml-1">{a.start_time}</span>}
                                          </td>
                                          <td className="px-4 py-3 font-medium text-gray-900">{a.course_name}</td>
                                          <td className="px-4 py-3 text-gray-600">{a.teacher_name}</td>
                                          <td className="px-4 py-3 text-gray-500 text-xs">{a.location_name}</td>
                                          <td className="px-4 py-3 text-gray-500 text-xs">{a.room_name}</td>
                                          <td className="px-4 py-3 text-right font-semibold text-orange-600">
                                            {a.credits_deducted > 0 ? a.credits_deducted : <span className="text-gray-300 font-normal">—</span>}
                                          </td>
                                          <td className="px-4 py-3 text-xs text-gray-400">{a.access_source}</td>
                                          <td className="px-4 py-3">
                                            <span className={`text-xs px-2 py-0.5 rounded-full ${a.status === 'present' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                                              {a.status}
                                            </span>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}

                              {/* Export for this student */}
                              {sc.attendance.length > 0 && (
                                <div className="px-6 py-3 border-t border-gray-50 flex justify-end">
                                  <button
                                    onClick={() => downloadCSV(
                                      sc.attendance.map(a => ({
                                        Student: sc.student_name,
                                        Date: a.date,
                                        Time: a.start_time,
                                        Lesson: a.course_name,
                                        Teacher: a.teacher_name,
                                        Location: a.location_name,
                                        Room: a.room_name,
                                        'Credits Deducted': a.credits_deducted,
                                        'Access Source': a.access_source,
                                        Status: a.status,
                                      })),
                                      `${sc.student_name.replace(/\s+/g, '-')}-classes-${new Date().toISOString().slice(0, 10)}.csv`
                                    )}
                                    className="text-xs text-[#6B1F3A] border border-[#6B1F3A]/30 px-3 py-1.5 rounded-lg hover:bg-[#6B1F3A]/5 transition"
                                  >
                                    {t('exportCSV')}
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* Export all */}
                  {filteredScRows.length > 0 && (
                    <div className="flex justify-end">
                      <button
                        onClick={() => {
                          const allRows: Record<string, unknown>[] = []
                          for (const sc of filteredScRows) {
                            for (const a of sc.attendance) {
                              allRows.push({
                                Student: sc.student_name,
                                Date: a.date,
                                Time: a.start_time,
                                Lesson: a.course_name,
                                Teacher: a.teacher_name,
                                Location: a.location_name,
                                Room: a.room_name,
                                'Credits Deducted': a.credits_deducted,
                                'Access Source': a.access_source,
                                Status: a.status,
                              })
                            }
                          }
                          downloadCSV(allRows, `student-classes-${new Date().toISOString().slice(0, 10)}.csv`)
                        }}
                        className="text-sm text-[#6B1F3A] border border-[#6B1F3A]/30 px-4 py-2 rounded-lg hover:bg-[#6B1F3A]/5 transition"
                      >
                        {t('exportAllCSV')}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Teachers Tab ─────────────────────────────────────────────────── */}
          {activeTab === 'teachers' && (
            <div className="space-y-6">
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h2 className="font-semibold text-gray-900">{t('teacherPerformanceTitle')}</h2>
                  {filteredTeachers.length > 0 && (
                    <Tooltip align="right" text={t('exportTeachersTooltip', { count: filteredTeachers.length })}>
                      <button
                        onClick={() => downloadCSV(
                          filteredTeachers.map(r => ({ Name: r.name, 'Lessons (Month)': r.lessons_this_month, 'Total Students': r.total_students, 'Attendance Rate': r.attendance_rate === '—' ? '—' : `${r.attendance_rate}%`, 'Compensation Estimate (€)': r.compensation_estimate.toFixed(2) })),
                          `school-teachers-${new Date().toISOString().slice(0, 10)}.csv`
                        )}
                        className="text-sm text-[#6B1F3A] border border-[#6B1F3A]/30 px-3 py-1.5 rounded-lg hover:bg-[#6B1F3A]/5 transition"
                      >
                        {t('exportCSV')}
                      </button>
                    </Tooltip>
                  )}
                </div>
                {filteredTeachers.length === 0 ? (
                  <div className="p-8 text-center text-sm text-gray-400">{t('noTeachers')}</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50">
                          <SortTh label={t('colTeacher')} col="name" sortCol={teacherSortCol} sortDir={teacherSortDir} onSort={handleTeacherSort} />
                          <SortTh label={t('colLessonsMonth')} col="lessons_this_month" sortCol={teacherSortCol} sortDir={teacherSortDir} onSort={handleTeacherSort} right />
                          <SortTh label={t('colStudents')} col="total_students" sortCol={teacherSortCol} sortDir={teacherSortDir} onSort={handleTeacherSort} right />
                          <SortTh label={t('colAttendanceRate')} col="attendance_rate" sortCol={teacherSortCol} sortDir={teacherSortDir} onSort={handleTeacherSort} right />
                          <SortTh label={t('colEstCompensation')} col="compensation_estimate" sortCol={teacherSortCol} sortDir={teacherSortDir} onSort={handleTeacherSort} right />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {filteredTeachers.map((row) => (
                          <tr key={row.id} className="hover:bg-gray-50 transition">
                            <td className="px-4 py-3 font-medium text-gray-900">{row.name}</td>
                            <td className="px-4 py-3 text-right text-gray-900 font-medium">{row.lessons_this_month}</td>
                            <td className="px-4 py-3 text-right text-gray-900">{row.total_students}</td>
                            <td className="px-4 py-3 text-right">
                              {row.attendance_rate === '—' ? <span className="text-gray-400">—</span> : (
                                <span className={`font-semibold ${parseFloat(row.attendance_rate) >= 80 ? 'text-green-700' : parseFloat(row.attendance_rate) >= 60 ? 'text-yellow-600' : 'text-red-500'}`}>
                                  {row.attendance_rate}%
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-[#6B1F3A]">
                              {row.compensation_estimate > 0 ? `€${row.compensation_estimate.toFixed(2)}` : <span className="text-gray-400 font-normal">—</span>}
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
        </>
      )}
    </div>
  )
}
