'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Plan {
  id: string
  name: string
}

interface TeacherRow {
  teacher_id: string
  active: boolean
  teachers: {
    id: string
    name: string
    email: string
    phone: string | null
    active: boolean
    created_at: string
  } | null
  compensation_plans: { id: string; name: string } | null
}

export default function SchoolTeachersPage() {
  const [rows, setRows] = useState<TeacherRow[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [assigningId, setAssigningId] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/school/teachers').then(r => r.json()),
      fetch('/api/school/compensation-plans').then(r => r.json()),
    ]).then(([teachers, plansData]) => {
      setRows(teachers)
      setPlans(plansData)
      setLoading(false)
    })
  }, [])

  async function assignPlan(teacherId: string, planId: string) {
    setAssigningId(teacherId)
    await fetch(`/api/school/teachers/${teacherId}/compensation`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ compensation_plan_id: planId || null }),
    })
    // Refresh
    const data = await fetch('/api/school/teachers').then(r => r.json())
    setRows(data)
    setAssigningId(null)
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Teachers</h1>
          <p className="text-gray-500 text-sm mt-1">{rows.length} teachers</p>
        </div>
        <Link
          href="/school/teachers/invite"
          className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition"
        >
          + Invite Teacher
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading...</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">
            No teachers yet.{' '}
            <Link href="/school/teachers/invite" className="text-[#6B1F3A] hover:underline">
              Invite your first teacher →
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Teacher</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Phone</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Compensation Plan</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(row => {
                const t = row.teachers
                if (!t) return null
                const currentPlanId = row.compensation_plans?.id ?? ''
                return (
                  <tr key={row.teacher_id} className="hover:bg-gray-50 transition">
                    <td className="px-6 py-3">
                      <p className="font-medium text-gray-900">{t.name}</p>
                      <p className="text-xs text-gray-400">{t.email}</p>
                    </td>
                    <td className="px-6 py-3 text-gray-600">{t.phone ?? '—'}</td>
                    <td className="px-6 py-3">
                      <select
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white disabled:opacity-50"
                        value={currentPlanId}
                        disabled={assigningId === row.teacher_id}
                        onChange={e => assignPlan(row.teacher_id, e.target.value)}
                      >
                        <option value="">No plan</option>
                        {plans.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-6 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        t.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {t.active ? 'Active' : 'Inactive'}
                      </span>
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
}
