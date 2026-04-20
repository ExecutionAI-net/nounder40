'use client'

import { useEffect, useState, useCallback } from 'react'

type SchoolRow = {
  id: string
  name: string
  city: string
  country: string
  active: boolean
  students: number
  teachers: number
  lessons_this_month: number
  revenue_this_month: number
}

type KPIs = {
  active_schools: number
  inactive_schools: number
  total_students: number
  total_teachers: number
  monthly_revenue: number
}

function exportCSV(rows: SchoolRow[]) {
  const headers = ['Name', 'City', 'Country', 'Status', 'Students', 'Teachers', 'Lessons (Month)', 'Revenue (Month)']
  const lines = rows.map(r => [
    r.name,
    r.city,
    r.country,
    r.active ? 'Active' : 'Inactive',
    r.students,
    r.teachers,
    r.lessons_this_month,
    r.revenue_this_month.toFixed(2),
  ].join(','))
  const csv = [headers.join(','), ...lines].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `hq-school-performance-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function HQReportsPage() {
  const [kpis, setKpis] = useState<KPIs | null>(null)
  const [schools, setSchools] = useState<SchoolRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/hq/reports')
      if (res.ok) {
        const data = await res.json()
        setKpis(data.kpis)
        setSchools(data.schools)
      }
    } catch {
      // handle gracefully
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-gray-500 text-sm mt-0.5">Network-level analytics and school performance</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        {[
          { label: 'Active Schools', value: loading ? '—' : (kpis?.active_schools ?? 0) },
          { label: 'Inactive Schools', value: loading ? '—' : (kpis?.inactive_schools ?? 0) },
          { label: 'Total Students', value: loading ? '—' : (kpis?.total_students ?? 0) },
          { label: 'Total Teachers', value: loading ? '—' : (kpis?.total_teachers ?? 0) },
          {
            label: 'Monthly Revenue',
            value: loading ? '—' : `€${(kpis?.monthly_revenue ?? 0).toFixed(2)}`,
            highlight: true,
          },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-white rounded-xl border border-gray-100 p-5">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{kpi.label}</p>
            <p className={`text-2xl font-bold mt-1 ${kpi.highlight ? 'text-[#6B1F3A]' : 'text-gray-900'}`}>
              {kpi.value}
            </p>
          </div>
        ))}
      </div>

      {/* School Performance Table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">School Performance</h2>
          {schools.length > 0 && (
            <button
              onClick={() => exportCSV(schools)}
              className="text-sm text-[#6B1F3A] border border-[#6B1F3A]/30 px-3 py-1.5 rounded-lg hover:bg-[#6B1F3A]/5 transition"
            >
              Export CSV
            </button>
          )}
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading...</div>
        ) : schools.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">No schools yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">School</th>
                  <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">City</th>
                  <th className="text-right px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Students</th>
                  <th className="text-right px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Teachers</th>
                  <th className="text-right px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Lessons (Month)</th>
                  <th className="text-right px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Revenue (Month)</th>
                  <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {schools.map((school) => (
                  <tr key={school.id} className="hover:bg-gray-50 transition">
                    <td className="px-6 py-3">
                      <p className="font-medium text-gray-900">{school.name}</p>
                    </td>
                    <td className="px-6 py-3 text-gray-500">
                      {school.city}, {school.country}
                    </td>
                    <td className="px-6 py-3 text-right text-gray-900 font-medium">{school.students}</td>
                    <td className="px-6 py-3 text-right text-gray-900 font-medium">{school.teachers}</td>
                    <td className="px-6 py-3 text-right text-gray-900 font-medium">{school.lessons_this_month}</td>
                    <td className="px-6 py-3 text-right font-semibold text-[#6B1F3A]">
                      €{school.revenue_this_month.toFixed(2)}
                    </td>
                    <td className="px-6 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        school.active
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}>
                        {school.active ? 'Active' : 'Inactive'}
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
  )
}
