'use client'

import { useEffect, useState, useCallback } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

type LessonRow = {
  id: string
  name: string
  date: string
  teacher: string
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
  lessons: {
    total: number
    total_attendance: number
    no_show_rate: string
    cancellation_rate: string
    rows: LessonRow[]
  }
  students: {
    total: number
    avg_credits: string
    docs_expired: number
    rows: StudentRow[]
  }
  teachers: {
    rows: TeacherRow[]
  }
}

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
  const csv = [headers.join(','), ...lines].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── Tab definitions ───────────────────────────────────────────────────────────

type Tab = 'lessons' | 'students' | 'teachers'
const TABS: { id: Tab; label: string }[] = [
  { id: 'lessons', label: 'Lessons' },
  { id: 'students', label: 'Students' },
  { id: 'teachers', label: 'Teachers' },
]

// ── Page component ────────────────────────────────────────────────────────────

export default function SchoolReportsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('lessons')
  const [data, setData] = useState<ReportsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/school/reports')
      if (!res.ok) {
        setError('Failed to load reports.')
        return
      }
      setData(await res.json())
    } catch {
      setError('Failed to load reports.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const now = new Date()
  const monthLabel = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
        <p className="text-gray-500 text-sm mt-0.5">Analytics for {monthLabel}</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition ${
              activeTab === tab.id
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400 text-sm">
          Loading...
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* ── Lessons Tab ──────────────────────────────────────────────── */}
          {activeTab === 'lessons' && (
            <div className="space-y-6">
              {/* KPI Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: 'Lessons This Month', value: data.lessons.total },
                  { label: 'Total Attendance', value: data.lessons.total_attendance },
                  { label: 'No-Show Rate', value: `${data.lessons.no_show_rate}%` },
                  { label: 'Cancellation Rate', value: `${data.lessons.cancellation_rate}%` },
                ].map((kpi) => (
                  <div key={kpi.label} className="bg-white rounded-xl border border-gray-100 p-5">
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{kpi.label}</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{kpi.value}</p>
                  </div>
                ))}
              </div>

              {/* Table */}
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h2 className="font-semibold text-gray-900">Lessons Detail</h2>
                  {data.lessons.rows.length > 0 && (
                    <button
                      onClick={() =>
                        downloadCSV(
                          data.lessons.rows.map((r) => ({
                            Name: r.name,
                            Date: r.date,
                            Teacher: r.teacher,
                            Capacity: r.capacity,
                            Booked: r.booked,
                            Attended: r.attended,
                            'No Shows': r.no_shows,
                            Cancelled: r.cancelled,
                            Status: r.status,
                          })),
                          `school-lessons-${now.toISOString().slice(0, 10)}.csv`
                        )
                      }
                      className="text-sm text-[#6B1F3A] border border-[#6B1F3A]/30 px-3 py-1.5 rounded-lg hover:bg-[#6B1F3A]/5 transition"
                    >
                      Export CSV
                    </button>
                  )}
                </div>

                {data.lessons.rows.length === 0 ? (
                  <div className="p-8 text-center text-sm text-gray-400">No lessons this month yet.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50">
                          <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Lesson</th>
                          <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Date</th>
                          <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Teacher</th>
                          <th className="text-right px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Capacity</th>
                          <th className="text-right px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Booked</th>
                          <th className="text-right px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Attended</th>
                          <th className="text-right px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">No-Shows</th>
                          <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {data.lessons.rows.map((row) => (
                          <tr key={row.id} className="hover:bg-gray-50 transition">
                            <td className="px-6 py-3 font-medium text-gray-900">{row.name}</td>
                            <td className="px-6 py-3 text-gray-500 whitespace-nowrap">
                              {new Date(row.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </td>
                            <td className="px-6 py-3 text-gray-600">{row.teacher}</td>
                            <td className="px-6 py-3 text-right text-gray-900">{row.capacity}</td>
                            <td className="px-6 py-3 text-right text-gray-900">{row.booked}</td>
                            <td className="px-6 py-3 text-right font-semibold text-green-700">{row.attended}</td>
                            <td className="px-6 py-3 text-right font-semibold text-red-500">{row.no_shows}</td>
                            <td className="px-6 py-3">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${
                                row.status === 'completed'
                                  ? 'bg-green-100 text-green-700'
                                  : row.status === 'cancelled'
                                  ? 'bg-red-100 text-red-600'
                                  : 'bg-blue-100 text-blue-700'
                              }`}>
                                {row.status}
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

          {/* ── Students Tab ──────────────────────────────────────────────── */}
          {activeTab === 'students' && (
            <div className="space-y-6">
              {/* KPI Cards */}
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'Total Active Students', value: data.students.total },
                  { label: 'Avg Credits Remaining', value: data.students.avg_credits },
                  { label: 'Documents Expired', value: data.students.docs_expired, warn: data.students.docs_expired > 0 },
                ].map((kpi) => (
                  <div key={kpi.label} className="bg-white rounded-xl border border-gray-100 p-5">
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{kpi.label}</p>
                    <p className={`text-2xl font-bold mt-1 ${kpi.warn ? 'text-red-600' : 'text-gray-900'}`}>
                      {kpi.value}
                    </p>
                  </div>
                ))}
              </div>

              {/* Table */}
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h2 className="font-semibold text-gray-900">Students Detail</h2>
                  {data.students.rows.length > 0 && (
                    <button
                      onClick={() =>
                        downloadCSV(
                          data.students.rows.map((r) => ({
                            Name: r.name,
                            'Credits Remaining': r.credits_remaining,
                            'Last Attendance': r.last_attendance,
                            'Total Attended': r.total_attended,
                            'Active Package': r.has_active_package ? 'Yes' : 'No',
                          })),
                          `school-students-${now.toISOString().slice(0, 10)}.csv`
                        )
                      }
                      className="text-sm text-[#6B1F3A] border border-[#6B1F3A]/30 px-3 py-1.5 rounded-lg hover:bg-[#6B1F3A]/5 transition"
                    >
                      Export CSV
                    </button>
                  )}
                </div>

                {data.students.rows.length === 0 ? (
                  <div className="p-8 text-center text-sm text-gray-400">No students enrolled yet.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50">
                          <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Student</th>
                          <th className="text-right px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Credits</th>
                          <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Last Attendance</th>
                          <th className="text-right px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Total Lessons</th>
                          <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Package</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {data.students.rows.map((row) => (
                          <tr key={row.id} className="hover:bg-gray-50 transition">
                            <td className="px-6 py-3 font-medium text-gray-900">{row.name}</td>
                            <td className="px-6 py-3 text-right font-semibold text-[#6B1F3A]">{row.credits_remaining}</td>
                            <td className="px-6 py-3 text-gray-500">{row.last_attendance}</td>
                            <td className="px-6 py-3 text-right text-gray-900 font-medium">{row.total_attended}</td>
                            <td className="px-6 py-3">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${
                                row.has_active_package
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-gray-100 text-gray-500'
                              }`}>
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

          {/* ── Teachers Tab ──────────────────────────────────────────────── */}
          {activeTab === 'teachers' && (
            <div className="space-y-6">
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h2 className="font-semibold text-gray-900">Teacher Performance</h2>
                  {data.teachers.rows.length > 0 && (
                    <button
                      onClick={() =>
                        downloadCSV(
                          data.teachers.rows.map((r) => ({
                            Name: r.name,
                            'Lessons (Month)': r.lessons_this_month,
                            'Total Students': r.total_students,
                            'Attendance Rate': r.attendance_rate === '—' ? '—' : `${r.attendance_rate}%`,
                            'Compensation Estimate (€)': r.compensation_estimate.toFixed(2),
                          })),
                          `school-teachers-${now.toISOString().slice(0, 10)}.csv`
                        )
                      }
                      className="text-sm text-[#6B1F3A] border border-[#6B1F3A]/30 px-3 py-1.5 rounded-lg hover:bg-[#6B1F3A]/5 transition"
                    >
                      Export CSV
                    </button>
                  )}
                </div>

                {data.teachers.rows.length === 0 ? (
                  <div className="p-8 text-center text-sm text-gray-400">No active teachers yet.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50">
                          <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Teacher</th>
                          <th className="text-right px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Lessons (Month)</th>
                          <th className="text-right px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Students</th>
                          <th className="text-right px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Attendance Rate</th>
                          <th className="text-right px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Est. Compensation</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {data.teachers.rows.map((row) => (
                          <tr key={row.id} className="hover:bg-gray-50 transition">
                            <td className="px-6 py-3 font-medium text-gray-900">{row.name}</td>
                            <td className="px-6 py-3 text-right text-gray-900 font-medium">{row.lessons_this_month}</td>
                            <td className="px-6 py-3 text-right text-gray-900">{row.total_students}</td>
                            <td className="px-6 py-3 text-right">
                              {row.attendance_rate === '—' ? (
                                <span className="text-gray-400">—</span>
                              ) : (
                                <span className={`font-semibold ${
                                  parseFloat(row.attendance_rate) >= 80
                                    ? 'text-green-700'
                                    : parseFloat(row.attendance_rate) >= 60
                                    ? 'text-yellow-600'
                                    : 'text-red-500'
                                }`}>
                                  {row.attendance_rate}%
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-3 text-right font-semibold text-[#6B1F3A]">
                              {row.compensation_estimate > 0
                                ? `€${row.compensation_estimate.toFixed(2)}`
                                : <span className="text-gray-400 font-normal">—</span>}
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
