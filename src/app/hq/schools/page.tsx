'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type School = {
  id: string
  name: string
  city: string
  country: string
  email: string
  phone: string | null
  address: string | null
  active: boolean
  platform_fee_percentage: number
  created_at: string
  teacherCount: number
  studentCount: number
  activeLessonCount: number
}

type EditForm = {
  name: string
  city: string
  country: string
  email: string
  phone: string
  address: string
  platform_fee_percentage: number
}

type SortKey = 'name' | 'city' | 'teacherCount' | 'studentCount' | 'activeLessonCount' | 'platform_fee_percentage' | 'created_at'

export default function SchoolsPage() {
  const [schools, setSchools] = useState<School[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<School | null>(null)
  const [form, setForm] = useState<EditForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDesc, setSortDesc] = useState(false)

  async function load() {
    const res = await fetch('/api/hq/schools')
    if (res.ok) setSchools(await res.json())
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function getFilteredAndSorted() {
    let filtered = schools

    if (statusFilter !== 'all') {
      filtered = filtered.filter(s => statusFilter === 'active' ? s.active : !s.active)
    }

    if (sortKey) {
      filtered = [...filtered].sort((a, b) => {
        let aVal = a[sortKey as keyof School]
        let bVal = b[sortKey as keyof School]

        if (typeof aVal === 'string') aVal = (aVal as string).toLowerCase()
        if (typeof bVal === 'string') bVal = (bVal as string).toLowerCase()

        if (aVal < bVal) return sortDesc ? 1 : -1
        if (aVal > bVal) return sortDesc ? -1 : 1
        return 0
      })
    }

    return filtered
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDesc(!sortDesc)
    } else {
      setSortKey(key)
      setSortDesc(false)
    }
  }

  function getSortIndicator(key: SortKey) {
    if (sortKey !== key) return ' ↕'
    return sortDesc ? ' ↓' : ' ↑'
  }

  function openEdit(school: School) {
    setEditing(school)
    setForm({
      name: school.name,
      city: school.city,
      country: school.country ?? '',
      email: school.email,
      phone: school.phone ?? '',
      address: school.address ?? '',
      platform_fee_percentage: school.platform_fee_percentage,
    })
    setSaveError('')
  }

  async function handleSave() {
    if (!editing || !form) return
    setSaving(true)
    setSaveError('')
    const res = await fetch(`/api/hq/schools/${editing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name,
        city: form.city,
        country: form.country,
        email: form.email,
        phone: form.phone || null,
        address: form.address || null,
        platform_fee_percentage: Number(form.platform_fee_percentage),
      }),
    })
    if (res.ok) {
      setEditing(null)
      setForm(null)
      load()
    } else {
      const d = await res.json()
      setSaveError(d.error ?? 'Save failed')
    }
    setSaving(false)
  }

  const filtered = getFilteredAndSorted()

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Schools</h1>
          <p className="text-gray-500 text-sm mt-1">{filtered.length} schools {statusFilter !== 'all' && `(${statusFilter})`} of {schools.length} total</p>
        </div>
        <Link
          href="/hq/schools/new"
          className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition"
        >
          + New School
        </Link>
      </div>

      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setStatusFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
            statusFilter === 'all'
              ? 'bg-[#6B1F3A] text-white'
              : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          All Schools
        </button>
        <button
          onClick={() => setStatusFilter('active')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
            statusFilter === 'active'
              ? 'bg-green-600 text-white'
              : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          Active Only
        </button>
        <button
          onClick={() => setStatusFilter('inactive')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
            statusFilter === 'inactive'
              ? 'bg-gray-600 text-white'
              : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          Inactive Only
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-gray-400">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          {!filtered.length ? (
            <div className="p-8 text-center text-sm text-gray-400">{schools.length === 0 ? 'No schools yet.' : 'No schools match the filter.'}</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">School</th>
                  <th className="cursor-pointer text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide hover:text-gray-700"
                    onClick={() => handleSort('city')}>City{getSortIndicator('city')}</th>
                  <th className="cursor-pointer text-center px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide hover:text-gray-700"
                    onClick={() => handleSort('teacherCount')}>Teachers{getSortIndicator('teacherCount')}</th>
                  <th className="cursor-pointer text-center px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide hover:text-gray-700"
                    onClick={() => handleSort('studentCount')}>Students{getSortIndicator('studentCount')}</th>
                  <th className="cursor-pointer text-center px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide hover:text-gray-700"
                    onClick={() => handleSort('activeLessonCount')}>Active Lessons{getSortIndicator('activeLessonCount')}</th>
                  <th className="cursor-pointer text-left px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide hover:text-gray-700"
                    onClick={() => handleSort('platform_fee_percentage')}>Fee{getSortIndicator('platform_fee_percentage')}</th>
                  <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((school) => (
                  <tr key={school.id} className="hover:bg-gray-50 transition">
                    <td className="px-6 py-3">
                      <Link href={`/hq/schools/${school.id}`} className="font-medium text-gray-900 hover:text-[#6B1F3A]">
                        {school.name}
                      </Link>
                      <p className="text-xs text-gray-400">{school.email}</p>
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-600">
                      {school.city}{school.country ? `, ${school.country}` : ''}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-sm font-semibold text-gray-900">{school.teacherCount}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-sm font-semibold text-gray-900">{school.studentCount}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-sm font-semibold text-gray-900">{school.activeLessonCount}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{school.platform_fee_percentage}%</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${school.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {school.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openEdit(school)}
                        className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 hover:border-gray-300 transition"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Edit Modal */}
      {editing && form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 pt-6 pb-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 text-lg">Edit School</h3>
              <p className="text-sm text-gray-400 mt-0.5">{editing.name}</p>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">School Name</label>
                  <input
                    value={form.name}
                    onChange={e => setForm(f => f && ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">City</label>
                  <input
                    value={form.city}
                    onChange={e => setForm(f => f && ({ ...f, city: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Country</label>
                  <input
                    value={form.country}
                    onChange={e => setForm(f => f && ({ ...f, country: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={e => setForm(f => f && ({ ...f, email: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Phone</label>
                  <input
                    value={form.phone}
                    onChange={e => setForm(f => f && ({ ...f, phone: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Platform Fee %</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={form.platform_fee_percentage}
                    onChange={e => setForm(f => f && ({ ...f, platform_fee_percentage: Number(e.target.value) }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Address</label>
                  <input
                    value={form.address}
                    onChange={e => setForm(f => f && ({ ...f, address: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                  />
                </div>
              </div>
              {saveError && <p className="text-xs text-red-500">{saveError}</p>}
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-2.5 bg-[#6B1F3A] text-white rounded-xl text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                onClick={() => { setEditing(null); setForm(null) }}
                className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
