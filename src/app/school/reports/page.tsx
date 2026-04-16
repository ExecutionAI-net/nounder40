'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

type LessonRow = {
  id: string
  name: string
  date: string
  teacher: string
  teacher_id: string | null
  room: string
  room_id: string | null
  location: string
  location_id: string | null
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

// ── Tab ───────────────────────────────────────────────────────────────────────

type Tab = 'lessons' | 'students' | 'teachers'
const TABS: { id: Tab; label: string }[] = [
  { id: 'lessons', label: 'Lessons' },
  { id: 'students', label: 'Students' },
  { id: 'teachers', label: 'Teachers' },
]

// ── Sort header ───────────────────────────────────────────────────────────────

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
  const [activeTab, setActiveTab] = useState<Tab>('lessons')
  const [data, setData] = useState<ReportsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Lesson filters
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [filterTeacher, setFilterTeacher] = useState('')
  const [filterLocation, setFilterLocation] = useState('')
  const [filterRoom, setFilterRoom] = useState('')

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
      const res = await fetch('/api/school/reports')
      if (!res.ok) { setError('Failed to load reports.'); return }
      setData(await res.json())
    } catch { setError('Failed to load reports.') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // ── Derived filter options ──────────────────────────────────────────────────

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
        (!filterLocation || r.location_id === filterLocation) &&
        !seen.has(r.room_id) && seen.add(r.room_id))
      .map(r => ({ id: r.room_id!, name: r.room }))
  }, [data, filterLocation])

  // ── Filtered + sorted lessons ───────────────────────────────────────────────

  const filteredLessons = useMemo(() => {
    if (!data) return []
    let rows = data.lessons.rows
    if (filterFrom) rows = rows.filter(r => r.date >= filterFrom)
    if (filterTo) rows = rows.filter(r => r.date <= filterTo)
    if (filterTeacher) rows = rows.filter(r => r.teacher_id === filterTeacher)
    if (filterLocation) rows = rows.filter(r => r.location_id === filterLocation)
    if (filterRoom) rows = rows.filter(r => r.room_id === filterRoom)

    return [...rows].sort((a, b) => {
      const av = a[lessonSortCol as keyof LessonRow]
      const bv = b[lessonSortCol as keyof LessonRow]
      if (av === null || av === undefined) return 1
      if (bv === null || bv === undefined) return -1
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true })
      return lessonSortDir === 'asc' ? cmp : -cmp
    })
  }, [data, filterFrom, filterTo, filterTeacher, filterLocation, filterRoom, lessonSortCol, lessonSortDir])

  function handleLessonSort(col: string) {
    if (lessonSortCol === col) setLessonSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setLessonSortCol(col); setLessonSortDir('asc') }
  }

  // ── KPIs derived from filtered lessons ─────────────────────────────────────

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

  const filteredStudents = useMemo(() => {
    if (!data) return []
    return [...data.students.rows].sort((a, b) => {
      const av = a[studentSortCol as keyof StudentRow]
      const bv = b[studentSortCol as keyof StudentRow]
      const cmp = String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true })
      return studentSortDir === 'asc' ? cmp : -cmp
    })
  }, [data, studentSortCol, studentSortDir])

  function handleStudentSort(col: string) {
    if (studentSortCol === col) setStudentSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setStudentSortCol(col); setStudentSortDir('asc') }
  }

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

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
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

      {loading && <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400 text-sm">Loading...</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-700">{error}</div>}

      {!loading && !error && data && (
        <>
          {/* ── Lessons Tab ─────────────────────────────────────────────────── */}
          {activeTab === 'lessons' && (
            <div className="space-y-6">
              {/* KPI Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: 'Total Lessons', value: lessonKpis.total },
                  { label: 'Total Attendance', value: lessonKpis.totalAttendance },
                  { label: 'No-Show Rate', value: `${lessonKpis.noShowRate}%` },
                  { label: 'Cancellation Rate', value: `${lessonKpis.cancellationRate}%` },
                ].map((kpi) => (
                  <div key={kpi.label} className="bg-white rounded-xl border border-gray-100 p-5">
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{kpi.label}</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{kpi.value}</p>
                  </div>
                ))}
              </div>

              {/* Filters */}
              <div className="bg-white rounded-xl border border-gray-100 px-5 py-4">
                <div className="flex flex-wrap gap-3 items-end">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">From</p>
                    <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">To</p>
                    <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Teacher</p>
                    <select value={filterTeacher} onChange={e => setFilterTeacher(e.target.value)} className={inputCls}>
                      <option value="">All teachers</option>
                      {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Location</p>
                    <select value={filterLocation} onChange={e => { setFilterLocation(e.target.value); setFilterRoom('') }} className={inputCls}>
                      <option value="">All locations</option>
                      {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Room</p>
                    <select value={filterRoom} onChange={e => setFilterRoom(e.target.value)} className={inputCls}>
                      <option value="">All rooms</option>
                      {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                  {(filterFrom || filterTo || filterTeacher || filterLocation || filterRoom) && (
                    <button
                      onClick={() => { setFilterFrom(''); setFilterTo(''); setFilterTeacher(''); setFilterLocation(''); setFilterRoom('') }}
                      className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg"
                    >
                      Clear filters
                    </button>
                  )}
                  <span className="text-xs text-gray-400 ml-auto self-center">{filteredLessons.length} lessons</span>
                </div>
              </div>

              {/* Table */}
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h2 className="font-semibold text-gray-900">Lessons Detail</h2>
                  {filteredLessons.length > 0 && (
                    <button
                      onClick={() => downloadCSV(
                        filteredLessons.map(r => ({
                          Name: r.name, Date: r.date, Teacher: r.teacher,
                          Location: r.location, Room: r.room,
                          Capacity: r.capacity, Booked: r.booked,
                          Attended: r.attended, 'No Shows': r.no_shows,
                          Cancelled: r.cancelled, Status: r.status,
                        })),
                        `school-lessons-${now.toISOString().slice(0, 10)}.csv`
                      )}
                      className="text-sm text-[#6B1F3A] border border-[#6B1F3A]/30 px-3 py-1.5 rounded-lg hover:bg-[#6B1F3A]/5 transition"
                    >
                      Export CSV
                    </button>
                  )}
                </div>

                {filteredLessons.length === 0 ? (
                  <div className="p-8 text-center text-sm text-gray-400">No lessons match the filters.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50">
                          <SortTh label="Lesson" col="name" sortCol={lessonSortCol} sortDir={lessonSortDir} onSort={handleLessonSort} />
                          <SortTh label="Date" col="date" sortCol={lessonSortCol} sortDir={lessonSortDir} onSort={handleLessonSort} />
                          <SortTh label="Teacher" col="teacher" sortCol={lessonSortCol} sortDir={lessonSortDir} onSort={handleLessonSort} />
                          <SortTh label="Location" col="location" sortCol={lessonSortCol} sortDir={lessonSortDir} onSort={handleLessonSort} />
                          <SortTh label="Room" col="room" sortCol={lessonSortCol} sortDir={lessonSortDir} onSort={handleLessonSort} />
                          <SortTh label="Capacity" col="capacity" sortCol={lessonSortCol} sortDir={lessonSortDir} onSort={handleLessonSort} right />
                          <SortTh label="Booked" col="booked" sortCol={lessonSortCol} sortDir={lessonSortDir} onSort={handleLessonSort} right />
                          <SortTh label="Attended" col="attended" sortCol={lessonSortCol} sortDir={lessonSortDir} onSort={handleLessonSort} right />
                          <SortTh label="No-Shows" col="no_shows" sortCol={lessonSortCol} sortDir={lessonSortDir} onSort={handleLessonSort} right />
                          <SortTh label="Status" col="status" sortCol={lessonSortCol} sortDir={lessonSortDir} onSort={handleLessonSort} />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {filteredLessons.map((row) => (
                          <tr key={row.id} className="hover:bg-gray-50 transition">
                            <td className="px-4 py-3 font-medium text-gray-900">{row.name}</td>
                            <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                              {new Date(row.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </td>
                            <td className="px-4 py-3 text-gray-600">{row.teacher}</td>
                            <td className="px-4 py-3 text-gray-500 text-xs">{row.location}</td>
                            <td className="px-4 py-3 text-gray-500 text-xs">{row.room}</td>
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
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'Total Active Students', value: data.students.total },
                  { label: 'Avg Credits Remaining', value: data.students.avg_credits },
                  { label: 'Documents Expired', value: data.students.docs_expired, warn: data.students.docs_expired > 0 },
                ].map((kpi) => (
                  <div key={kpi.label} className="bg-white rounded-xl border border-gray-100 p-5">
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{kpi.label}</p>
                    <p className={`text-2xl font-bold mt-1 ${kpi.warn ? 'text-red-600' : 'text-gray-900'}`}>{kpi.value}</p>
                  </div>
                ))}
              </div>

              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h2 className="font-semibold text-gray-900">Students Detail</h2>
                  {filteredStudents.length > 0 && (
                    <button onClick={() => downloadCSV(
                      filteredStudents.map(r => ({ Name: r.name, 'Credits Remaining': r.credits_remaining, 'Last Attendance': r.last_attendance, 'Total Attended': r.total_attended, 'Active Package': r.has_active_package ? 'Yes' : 'No' })),
                      `school-students-${now.toISOString().slice(0, 10)}.csv`
                    )} className="text-sm text-[#6B1F3A] border border-[#6B1F3A]/30 px-3 py-1.5 rounded-lg hover:bg-[#6B1F3A]/5 transition">
                      Export CSV
                    </button>
                  )}
                </div>
                {filteredStudents.length === 0 ? (
                  <div className="p-8 text-center text-sm text-gray-400">No students enrolled yet.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50">
                          <SortTh label="Student" col="name" sortCol={studentSortCol} sortDir={studentSortDir} onSort={handleStudentSort} />
                          <SortTh label="Credits" col="credits_remaining" sortCol={studentSortCol} sortDir={studentSortDir} onSort={handleStudentSort} right />
                          <SortTh label="Last Attendance" col="last_attendance" sortCol={studentSortCol} sortDir={studentSortDir} onSort={handleStudentSort} />
                          <SortTh label="Total Lessons" col="total_attended" sortCol={studentSortCol} sortDir={studentSortDir} onSort={handleStudentSort} right />
                          <SortTh label="Package" col="has_active_package" sortCol={studentSortCol} sortDir={studentSortDir} onSort={handleStudentSort} />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {filteredStudents.map((row) => (
                          <tr key={row.id} className="hover:bg-gray-50 transition">
                            <td className="px-4 py-3 font-medium text-gray-900">{row.name}</td>
                            <td className="px-4 py-3 text-right font-semibold text-[#6B1F3A]">{row.credits_remaining}</td>
                            <td className="px-4 py-3 text-gray-500">{row.last_attendance}</td>
                            <td className="px-4 py-3 text-right text-gray-900 font-medium">{row.total_attended}</td>
                            <td className="px-4 py-3">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${row.has_active_package ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                {row.has_active_package ? 'Active' : 'None'}
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
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h2 className="font-semibold text-gray-900">Teacher Performance</h2>
                  {filteredTeachers.length > 0 && (
                    <button onClick={() => downloadCSV(
                      filteredTeachers.map(r => ({ Name: r.name, 'Lessons (Month)': r.lessons_this_month, 'Total Students': r.total_students, 'Attendance Rate': r.attendance_rate === '—' ? '—' : `${r.attendance_rate}%`, 'Compensation Estimate (€)': r.compensation_estimate.toFixed(2) })),
                      `school-teachers-${now.toISOString().slice(0, 10)}.csv`
                    )} className="text-sm text-[#6B1F3A] border border-[#6B1F3A]/30 px-3 py-1.5 rounded-lg hover:bg-[#6B1F3A]/5 transition">
                      Export CSV
                    </button>
                  )}
                </div>
                {filteredTeachers.length === 0 ? (
                  <div className="p-8 text-center text-sm text-gray-400">No active teachers yet.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50">
                          <SortTh label="Teacher" col="name" sortCol={teacherSortCol} sortDir={teacherSortDir} onSort={handleTeacherSort} />
                          <SortTh label="Lessons (Month)" col="lessons_this_month" sortCol={teacherSortCol} sortDir={teacherSortDir} onSort={handleTeacherSort} right />
                          <SortTh label="Students" col="total_students" sortCol={teacherSortCol} sortDir={teacherSortDir} onSort={handleTeacherSort} right />
                          <SortTh label="Attendance Rate" col="attendance_rate" sortCol={teacherSortCol} sortDir={teacherSortDir} onSort={handleTeacherSort} right />
                          <SortTh label="Est. Compensation" col="compensation_estimate" sortCol={teacherSortCol} sortDir={teacherSortDir} onSort={handleTeacherSort} right />
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
