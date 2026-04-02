'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function InviteTeacherPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [done, setDone]       = useState<string | null>(null)
  const [form, setForm]       = useState({ name: '', email: '', phone: '' })

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
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
      setDone(form.name)
    } catch {
      setError('Request failed. Please try again.')
    }
    setLoading(false)
  }

  if (done) {
    return (
      <div className="max-w-md">
        <div className="mb-6">
          <Link href="/school/teachers" className="text-sm text-gray-400 hover:text-gray-600">← Back to Teachers</Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-2">Invitation Added</h1>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 space-y-2">
          <p className="font-semibold text-amber-800">Pending activation</p>
          <p className="text-amber-700 text-sm">
            <strong>{done}</strong> has been added to the pending list. Go to the Teachers page to approve and set their password.
          </p>
        </div>
        <div className="mt-4 flex gap-3">
          <Link href="/school/teachers"
            className="px-4 py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition">
            Go to Teachers
          </Link>
          <button onClick={() => { setDone(null); setForm({ name: '', email: '', phone: '' }) }}
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
        <h1 className="text-2xl font-bold text-gray-900 mt-2">Invite Teacher</h1>
        <p className="text-gray-500 text-sm mt-1">The teacher will appear as pending until you approve and set their password.</p>
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
            {loading ? 'Adding...' : 'Add to Pending'}
          </button>
          <Link href="/school/teachers"
            className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
