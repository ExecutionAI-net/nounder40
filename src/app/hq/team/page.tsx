'use client'

import { useEffect, useState } from 'react'

const SUB_ROLES = [
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'operations', label: 'Operations' },
  { value: 'tech_support', label: 'Tech Support' },
  { value: 'analytics', label: 'Analytics' },
  { value: 'support', label: 'Support' },
]

type Member = {
  id: string
  name: string
  email: string
  hq_sub_role: string
  created_at: string
}

export default function HQTeamPage() {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', hq_sub_role: 'operations' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdCreds, setCreatedCreds] = useState<{ email: string; tempPassword: string } | null>(null)

  useEffect(() => { fetchMembers() }, [])

  async function fetchMembers() {
    const res = await fetch('/api/hq/team')
    if (res.ok) setMembers(await res.json())
    setLoading(false)
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const res = await fetch('/api/hq/team', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? 'Something went wrong')
    } else {
      setCreatedCreds({ email: form.email, tempPassword: data.tempPassword })
      setForm({ name: '', email: '', hq_sub_role: 'operations' })
      setShowForm(false)
      await fetchMembers()
    }
    setSubmitting(false)
  }

  async function handleRemove(id: string, name: string) {
    if (!confirm(`Remove ${name} from the HQ team?`)) return
    const res = await fetch('/api/hq/team', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) {
      setMembers((m) => m.filter((x) => x.id !== id))
    }
  }

  function roleLabel(val: string) {
    return SUB_ROLES.find((r) => r.value === val)?.label ?? val
  }

  if (loading) return <div className="text-sm text-gray-400">Loading...</div>

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">HQ Team</h1>
          <p className="text-gray-500 text-sm mt-1">{members.length} team members</p>
        </div>
        <button
          onClick={() => { setShowForm(true); setCreatedCreds(null) }}
          className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition"
        >
          + Invite Member
        </button>
      </div>

      {createdCreds && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-xl text-sm">
          <div className="flex items-center justify-between mb-2">
            <p className="font-semibold text-green-800">Member created successfully</p>
            <button onClick={() => setCreatedCreds(null)} className="text-green-600 hover:text-green-800 text-xs">Dismiss</button>
          </div>
          <p className="text-green-700 mb-1">Share these credentials with the new member:</p>
          <div className="bg-white border border-green-200 rounded-lg p-3 font-mono text-xs space-y-1">
            <div><span className="text-gray-400">Email:</span> <span className="text-gray-900 select-all">{createdCreds.email}</span></div>
            <div><span className="text-gray-400">Password:</span> <span className="text-gray-900 select-all font-bold">{createdCreds.tempPassword}</span></div>
          </div>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleInvite} className="bg-white rounded-xl border border-gray-100 p-5 mb-5 space-y-4">
          <h3 className="font-medium text-gray-900">Invite Team Member</h3>
          {error && <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                placeholder="Jane Doe"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
              <input
                required
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                placeholder="jane@nounder40.com"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role *</label>
            <select
              value={form.hq_sub_role}
              onChange={(e) => setForm((f) => ({ ...f, hq_sub_role: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
            >
              {SUB_ROLES.filter((r) => r.value !== 'super_admin').map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {submitting ? 'Creating...' : 'Add Member'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {!members.length ? (
          <div className="p-8 text-center text-sm text-gray-400">No team members yet.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Member</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Role</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Added</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {members.map((m) => (
                <tr key={m.id} className="hover:bg-gray-50 transition">
                  <td className="px-6 py-3">
                    <p className="font-medium text-gray-900 text-sm">{m.name}</p>
                    <p className="text-xs text-gray-400">{m.email}</p>
                  </td>
                  <td className="px-6 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      m.hq_sub_role === 'super_admin'
                        ? 'bg-[#6B1F3A]/10 text-[#6B1F3A]'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {roleLabel(m.hq_sub_role)}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-400">
                    {new Date(m.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-3 text-right">
                    {m.hq_sub_role !== 'super_admin' && (
                      <button
                        onClick={() => handleRemove(m.id, m.name)}
                        className="text-xs text-red-400 hover:text-red-600"
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
