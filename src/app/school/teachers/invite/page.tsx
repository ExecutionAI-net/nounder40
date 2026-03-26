'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function InviteTeacherPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creds, setCreds] = useState<{ email: string; tempPassword: string } | null>(null)
  const [form, setForm] = useState({ name: '', email: '', phone: '' })

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const res = await fetch('/api/school/teachers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })

    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? 'Something went wrong')
      setLoading(false)
      return
    }

    setCreds({ email: form.email, tempPassword: data.tempPassword })
    setLoading(false)
  }

  if (creds) {
    return (
      <div className="max-w-md">
        <div className="mb-6">
          <Link href="/school/teachers" className="text-sm text-gray-400 hover:text-gray-600">← Back to Teachers</Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-2">Teacher Added</h1>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 space-y-3">
          <p className="font-semibold text-green-800">Account created successfully!</p>
          <p className="text-green-700 text-sm">Share these login credentials with the teacher:</p>
          <div className="bg-white border border-green-200 rounded-lg p-4 font-mono text-sm space-y-2">
            <div><span className="text-gray-400 text-xs">Email</span><br /><span className="text-gray-900 select-all">{creds.email}</span></div>
            <div><span className="text-gray-400 text-xs">Temporary Password</span><br /><span className="text-gray-900 select-all font-bold">{creds.tempPassword}</span></div>
          </div>
          <p className="text-xs text-green-600">The teacher can log in immediately and change their password from their profile.</p>
        </div>
        <div className="mt-4 flex gap-3">
          <Link href="/school/teachers" className="px-4 py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition">
            Back to Teachers
          </Link>
          <button onClick={() => { setCreds(null); setForm({ name: '', email: '', phone: '' }) }}
            className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition">
            Add Another
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-md">
      <div className="mb-6">
        <Link href="/school/teachers" className="text-sm text-gray-400 hover:text-gray-600">← Back to Teachers</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">Add Teacher</h1>
        <p className="text-gray-500 text-sm mt-1">A login will be created instantly — no email invite needed.</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
        {error && <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
          <input name="name" required value={form.name} onChange={handleChange}
            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]"
            placeholder="Marco Rossi" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
          <input name="email" type="email" required value={form.email} onChange={handleChange}
            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]"
            placeholder="teacher@example.com" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
          <input name="phone" value={form.phone} onChange={handleChange}
            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]"
            placeholder="+39 333 1234567" />
        </div>

        <div className="pt-2 flex gap-3">
          <button type="submit" disabled={loading}
            className="flex-1 py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50">
            {loading ? 'Creating...' : 'Add Teacher'}
          </button>
          <Link href="/school/teachers" className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
