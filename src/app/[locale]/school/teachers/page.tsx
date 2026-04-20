'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

interface TeacherRow {
  teacher_id: string
  active: boolean
  teachers: { id: string; name: string; email: string; phone: string | null; active: boolean; created_at: string } | null
}

export default function SchoolTeachersPage() {
  return <Suspense><TeachersPageInner /></Suspense>
}

function TeachersPageInner() {
  const searchParams = useSearchParams()
  const [rows, setRows]       = useState<TeacherRow[]>([])
  const [loading, setLoading] = useState(true)
  const [success, setSuccess] = useState<string | null>(null)
  const [resendingId, setResendingId] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)

  useEffect(() => {
    const added = searchParams.get('added')
    if (added) setSuccess(`${added} has been added and an invitation email has been sent.`)
    fetchData()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchData() {
    const teachersRes = await fetch('/api/school/teachers').then(r => r.ok ? r.json() : { teachers: [], pending: [] }) as { teachers: TeacherRow[], pending: unknown[] }
    setRows(Array.isArray(teachersRes.teachers) ? teachersRes.teachers : [])
    setLoading(false)
  }

  async function resendInvite(teacherId: string, name: string) {
    setResendingId(teacherId)
    const res = await fetch('/api/school/teachers/resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teacher_id: teacherId }),
    })
    if (res.ok) {
      setSuccess(`Invitation resent to ${name}.`)
    } else {
      const data = await res.json()
      setSuccess(`Error: ${data.error ?? 'Failed to resend'}`)
    }
    setResendingId(null)
  }

  async function removeTeacher(teacherId: string, name: string) {
    if (!confirm(`Remove ${name} from your school? This will unlink them but not delete their account.`)) return
    setRemovingId(teacherId)
    await fetch('/api/school/teachers', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teacher_id: teacherId }),
    })
    await fetchData()
    setRemovingId(null)
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Teachers</h1>
          <p className="text-gray-500 text-sm mt-1">{rows.length} teacher{rows.length !== 1 ? 's' : ''}</p>
        </div>
        <Link href="/school/teachers/invite"
          className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition">
          + Add Teacher
        </Link>
      </div>

      {success && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700 flex justify-between">
          {success}
          <button onClick={() => setSuccess(null)} className="text-green-500 hover:text-green-700 text-xs ml-4">✕</button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading...</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">
            No teachers yet.{' '}
            <Link href="/school/teachers/invite" className="text-[#6B1F3A] hover:underline">
              Add your first teacher →
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Teacher</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Phone</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Status</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(row => {
                const t = row.teachers
                if (!t) return null
                return (
                  <tr key={row.teacher_id} className="hover:bg-gray-50 transition">
                    <td className="px-6 py-3">
                      <p className="font-medium text-gray-900">{t.name}</p>
                      <p className="text-xs text-gray-400">{t.email}</p>
                    </td>
                    <td className="px-6 py-3 text-gray-600">{t.phone ?? '—'}</td>
                    <td className="px-6 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${t.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {t.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => resendInvite(row.teacher_id, t.name)}
                          disabled={resendingId === row.teacher_id}
                          className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 transition disabled:opacity-50 whitespace-nowrap">
                          {resendingId === row.teacher_id ? 'Sending...' : 'Resend Invite'}
                        </button>
                        <button
                          onClick={() => removeTeacher(row.teacher_id, t.name)}
                          disabled={removingId === row.teacher_id}
                          className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50">
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-gray-400 mt-4">
        Compensation plans are assigned per course. Go to{' '}
        <Link href="/school/courses" className="text-[#6B1F3A] hover:underline">Courses</Link>{' '}
        to edit a course and set its compensation plan.
      </p>
    </div>
  )
}
