'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

interface Plan { id: string; name: string }

interface TeacherRow {
  teacher_id: string
  active: boolean
  teachers: { id: string; name: string; email: string; phone: string | null; active: boolean; created_at: string } | null
  compensation_plans: { id: string; name: string } | null
}

interface PendingTeacher {
  id: string
  name: string
  email: string
  phone: string | null
  created_at: string
}

export default function SchoolTeachersPage() {
  return <Suspense><TeachersPageInner /></Suspense>
}

function TeachersPageInner() {
  const searchParams = useSearchParams()
  const [rows, setRows]       = useState<TeacherRow[]>([])
  const [pending, setPending] = useState<PendingTeacher[]>([])
  const [plans, setPlans]     = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [assigningId, setAssigningId] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [resendingId, setResendingId] = useState<string | null>(null)

  // Approve modal
  const [approveTarget, setApproveTarget] = useState<PendingTeacher | null>(null)
  const [approvePassword, setApprovePassword] = useState('')
  const [approving, setApproving] = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)

  useEffect(() => {
    const invited = searchParams.get('invited')
    if (invited) setSuccess(`${invited} added to pending. Use "Resend Invite" to send them an email.`)
    fetchData()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchData() {
    const [teachersRes, plansRes] = await Promise.all([
      fetch('/api/school/teachers').then(r => r.ok ? r.json() : { teachers: [], pending: [] }) as Promise<{ teachers: TeacherRow[], pending: PendingTeacher[] }>,
      fetch('/api/school/compensation-plans').then(r => r.ok ? r.json() : []),
    ])
    setRows(Array.isArray(teachersRes.teachers) ? teachersRes.teachers : [])
    setPending(Array.isArray(teachersRes.pending) ? teachersRes.pending : [])
    setPlans(Array.isArray(plansRes) ? plansRes : [])
    setLoading(false)
  }

  async function assignPlan(teacherId: string, planId: string) {
    setAssigningId(teacherId)
    await fetch(`/api/school/teachers/${teacherId}/compensation`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ compensation_plan_id: planId || null }),
    })
    await fetchData()
    setAssigningId(null)
  }

  async function resendInvite(id: string, name: string) {
    setResendingId(id)
    const res = await fetch('/api/school/teachers/resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) {
      setSuccess(`Invitation resent to ${name}.`)
    } else {
      const data = await res.json()
      setSuccess(`Error: ${data.error ?? 'Failed to resend'}`)
    }
    setResendingId(null)
  }

  async function removePending(id: string, name: string) {
    if (!confirm(`Remove pending invitation for ${name}?`)) return
    await fetch('/api/school/teachers', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    await fetchData()
  }

  async function handleApprove(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!approveTarget) return
    setApproving(true)
    setApproveError(null)
    const res = await fetch('/api/school/teachers/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: approveTarget.id, password: approvePassword }),
    })
    const data = await res.json()
    if (!res.ok) {
      setApproveError(data.error ?? 'Failed to activate')
      setApproving(false)
      return
    }
    setSuccess(`${approveTarget.name} has been activated.`)
    setApproveTarget(null)
    setApprovePassword('')
    await fetchData()
    setApproving(false)
  }

  return (
    <div>
      {/* Approve modal */}
      {approveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 text-lg">Activate Teacher</h3>
              <p className="text-sm text-gray-400 mt-0.5">Set a password to create their account</p>
            </div>
            <div className="px-6 py-4">
              <div className="bg-gray-50 rounded-xl p-4 mb-4">
                <p className="font-medium text-gray-900 text-sm">{approveTarget.name}</p>
                <p className="text-xs text-gray-400">{approveTarget.email}</p>
                {approveTarget.phone && <p className="text-xs text-gray-400">{approveTarget.phone}</p>}
              </div>
              <form onSubmit={handleApprove} className="space-y-3">
                {approveError && (
                  <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg">{approveError}</div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      minLength={8}
                      value={approvePassword}
                      onChange={e => setApprovePassword(e.target.value)}
                      placeholder="Min. 8 characters"
                      className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                    />
                    <button type="button"
                      onClick={() => {
                        const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
                        setApprovePassword('Nu40_' + Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''))
                      }}
                      className="px-3 py-2 text-xs border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 whitespace-nowrap">
                      Generate
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Share this password with the teacher after activation.</p>
                </div>
                <div className="flex gap-3 pt-1">
                  <button type="submit" disabled={approving}
                    className="flex-1 py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50">
                    {approving ? 'Activating...' : 'Activate Account'}
                  </button>
                  <button type="button"
                    onClick={() => { setApproveTarget(null); setApprovePassword(''); setApproveError(null) }}
                    className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Teachers</h1>
          <p className="text-gray-500 text-sm mt-1">{rows.length} active · {pending.length} pending</p>
        </div>
        <Link href="/school/teachers/invite"
          className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition">
          + Invite Teacher
        </Link>
      </div>

      {success && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700 flex justify-between">
          {success}
          <button onClick={() => setSuccess(null)} className="text-green-500 hover:text-green-700 text-xs ml-4">✕</button>
        </div>
      )}

      {/* Pending teachers */}
      {pending.length > 0 && (
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-2">
            <h2 className="text-sm font-semibold text-gray-700">Pending Invitations</h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">{pending.length}</span>
          </div>
          <div className="bg-white rounded-xl border border-amber-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-amber-50/50">
                  <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Teacher</th>
                  <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Phone</th>
                  <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Invited</th>
                  <th className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {pending.map(p => (
                  <tr key={p.id} className="hover:bg-gray-50 transition">
                    <td className="px-6 py-3">
                      <p className="font-medium text-gray-900">{p.name}</p>
                      <p className="text-xs text-gray-400">{p.email}</p>
                    </td>
                    <td className="px-6 py-3 text-gray-500">{p.phone ?? '—'}</td>
                    <td className="px-6 py-3 text-gray-400">{new Date(p.created_at).toLocaleDateString()}</td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => resendInvite(p.id, p.name)}
                          disabled={resendingId === p.id}
                          className="text-xs px-3 py-1.5 bg-[#6B1F3A] text-white rounded-lg hover:bg-[#5a1930] transition font-medium disabled:opacity-50">
                          {resendingId === p.id ? 'Sending...' : 'Resend Invite'}
                        </button>
                        <button onClick={() => removePending(p.id, p.name)}
                          className="text-xs text-red-400 hover:text-red-600">
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Active teachers */}
      <div>
        {pending.length > 0 && <h2 className="text-sm font-semibold text-gray-700 mb-2">Active Teachers</h2>}
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
                          value={row.compensation_plans?.id ?? ''}
                          disabled={assigningId === row.teacher_id}
                          onChange={e => assignPlan(row.teacher_id, e.target.value)}>
                          <option value="">No plan</option>
                          {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </td>
                      <td className="px-6 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${t.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
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
    </div>
  )
}
