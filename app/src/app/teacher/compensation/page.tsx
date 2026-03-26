'use client'

import { useEffect, useState } from 'react'

interface LessonFee {
  id: string
  date: string
  start_time: string
  course: string | null
  students: number
  fee: number
}

interface CompensationEntry {
  school: { name: string; city: string } | null
  plan: { name: string; base_fee: number; bonus_threshold: number; bonus_per_student: number } | null
  lessons: LessonFee[]
  total: number
}

export default function TeacherCompensationPage() {
  const [data, setData] = useState<CompensationEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/teacher/compensation')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
  }, [])

  if (loading) {
    return <div className="animate-pulse h-8 bg-gray-100 rounded w-48" />
  }

  const monthLabel = new Date().toLocaleDateString('en', { month: 'long', year: 'numeric' })

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Compensation</h1>
      <p className="text-gray-500 text-sm mb-6">{monthLabel}</p>

      {data.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-6 text-sm text-gray-400">
          No compensation data available.
        </div>
      ) : (
        <div className="space-y-6">
          {data.map((entry, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-gray-900">{entry.school?.name ?? '—'}</p>
                  <p className="text-xs text-gray-400">{entry.school?.city}</p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-gray-900">€{entry.total.toFixed(2)}</p>
                  {entry.plan && (
                    <p className="text-xs text-gray-400">{entry.plan.name}</p>
                  )}
                </div>
              </div>

              {entry.plan && (
                <div className="px-5 py-2 bg-gray-50 text-xs text-gray-500 flex gap-4">
                  <span>Base: €{entry.plan.base_fee}/lesson</span>
                  <span>Bonus: €{entry.plan.bonus_per_student}/student above {entry.plan.bonus_threshold}</span>
                </div>
              )}

              {entry.lessons.length === 0 ? (
                <div className="px-5 py-4 text-sm text-gray-400">No completed lessons this month.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-50">
                    <tr>
                      <th className="text-left px-5 py-2.5 text-xs font-medium text-gray-400">Date</th>
                      <th className="text-left px-5 py-2.5 text-xs font-medium text-gray-400">Course</th>
                      <th className="text-left px-5 py-2.5 text-xs font-medium text-gray-400">Students</th>
                      <th className="text-right px-5 py-2.5 text-xs font-medium text-gray-400">Fee</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {entry.lessons.map(l => (
                      <tr key={l.id}>
                        <td className="px-5 py-2.5 text-gray-500">
                          {new Date(l.date).toLocaleDateString('en', { month: 'short', day: 'numeric' })} {l.start_time?.slice(0, 5)}
                        </td>
                        <td className="px-5 py-2.5 text-gray-900">{l.course ?? '—'}</td>
                        <td className="px-5 py-2.5 text-gray-500">{l.students}</td>
                        <td className="px-5 py-2.5 text-gray-900 text-right font-medium">€{l.fee.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
