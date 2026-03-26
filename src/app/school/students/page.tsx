'use client'

import { useEffect, useState } from 'react'

interface StudentRow {
  id: string
  enrolled_at: string
  free_lesson_used: boolean
  students: {
    id: string
    name: string
    email: string
    phone: string | null
    city: string | null
    created_at: string
  } | null
}

export default function SchoolStudentsPage() {
  const [rows, setRows] = useState<StudentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch('/api/school/students')
      .then(r => r.json())
      .then(data => { setRows(data); setLoading(false) })
  }, [])

  const filtered = rows.filter(r => {
    if (!search) return true
    const s = r.students
    if (!s) return false
    return (
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.email.toLowerCase().includes(search.toLowerCase()) ||
      (s.city ?? '').toLowerCase().includes(search.toLowerCase())
    )
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Students</h1>
          <p className="text-gray-500 text-sm mt-0.5">{rows.length} enrolled</p>
        </div>
      </div>

      <div className="mb-4">
        <input
          placeholder="Search by name, email or city..."
          className="w-full max-w-sm border border-gray-200 rounded-lg px-3 py-2 text-sm"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">No students found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Name</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Email</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">City</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Enrolled</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Free Lesson</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(row => {
                const s = row.students
                if (!s) return null
                return (
                  <tr key={row.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3 font-medium text-gray-900">{s.name}</td>
                    <td className="px-4 py-3 text-gray-500">{s.email}</td>
                    <td className="px-4 py-3 text-gray-500">{s.city ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-400">
                      {new Date(row.enrolled_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                        row.free_lesson_used
                          ? 'bg-gray-100 text-gray-500'
                          : 'bg-green-100 text-green-700'
                      }`}>
                        {row.free_lesson_used ? 'Used' : 'Available'}
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
