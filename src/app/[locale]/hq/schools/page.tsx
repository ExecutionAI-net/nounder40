'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import ConfirmDeleteButton from '@/components/ui/ConfirmDeleteButton'
import ErrorBanner from '@/components/ui/ErrorBanner'

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
  const t = useTranslations('hq.schools')
  const locale = useLocale()
  const [schools, setSchools] = useState<School[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<School | null>(null)
  const [form, setForm] = useState<EditForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDesc, setSortDesc] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // First click: fetch linked records → build the "are you sure" label.
  // Blocked (financial records) → show error banner, don't arm.
  async function armDelete(school: School): Promise<string | null> {
    setDeleteError(null)
    const res = await fetch(`/api/hq/schools/${school.id}`, { cache: 'no-store' })
    if (!res.ok) { setDeleteError(t('errorSaveFailed')); return null }
    const { cascading, blocking } = await res.json()
    if (blocking.transactions > 0 || blocking.shopOrders > 0) {
      setDeleteError(t('deleteBlockedFinancial', { name: school.name, count: blocking.transactions + blocking.shopOrders }))
      return null
    }
    const parts = [
      cascading.students > 0 && t('linkedStudents', { count: cascading.students }),
      cascading.teachers > 0 && t('linkedTeachers', { count: cascading.teachers }),
      cascading.courses > 0 && t('linkedCourses', { count: cascading.courses }),
      cascading.lessons > 0 && t('linkedLessons', { count: cascading.lessons }),
    ].filter(Boolean)
    return parts.length
      ? t('deleteArmedLinked', { linked: parts.join(', ') })
      : t('deleteArmedClean')
  }

  async function handleDelete(school: School) {
    const res = await fetch(`/api/hq/schools/${school.id}`, { method: 'DELETE' })
    if (res.ok) {
      load()
    } else {
      const d = await res.json().catch(() => ({}))
      setDeleteError(
        d.error === 'has_financial_records'
          ? t('deleteBlockedFinancial', { name: school.name, count: (d.linked?.blocking?.transactions ?? 0) + (d.linked?.blocking?.shopOrders ?? 0) })
          : d.error ?? t('errorSaveFailed')
      )
    }
  }

  async function load() {
    const res = await fetch('/api/hq/schools', { cache: 'no-store' })
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
        let aVal = a[sortKey as keyof School] ?? ''
        let bVal = b[sortKey as keyof School] ?? ''

        if (typeof aVal === 'string') aVal = aVal.toLowerCase()
        if (typeof bVal === 'string') bVal = bVal.toLowerCase()

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
      setSaveError(d.error ?? t('errorSaveFailed'))
    }
    setSaving(false)
  }

  const filtered = getFilteredAndSorted()

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('pageTitle')}</h1>
          <p className="text-gray-500 text-sm mt-1">{t('pageSubtitle', { count: filtered.length, filter: statusFilter !== 'all' ? statusFilter : '', total: schools.length })}</p>
        </div>
        <Link
          href={`/${locale}/hq/schools/new`}
          className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition"
        >
          + {t('buttonNew')}
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
          {t('filterAll')}
        </button>
        <button
          onClick={() => setStatusFilter('active')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
            statusFilter === 'active'
              ? 'bg-green-600 text-white'
              : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          {t('filterActive')}
        </button>
        <button
          onClick={() => setStatusFilter('inactive')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
            statusFilter === 'inactive'
              ? 'bg-gray-600 text-white'
              : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          {t('filterInactive')}
        </button>
      </div>

      <ErrorBanner message={deleteError} onDismiss={() => setDeleteError(null)} />

      {loading ? (
        <div className="text-sm text-gray-400">{t('loading')}</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          {!filtered.length ? (
            <div className="p-8 text-center text-sm text-gray-400">{schools.length === 0 ? t('emptyState') : t('noMatch')}</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('columnSchool')}</th>
                  <th className="cursor-pointer text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide hover:text-gray-700"
                    onClick={() => handleSort('city')}>{t('columnCity')}{getSortIndicator('city')}</th>
                  <th className="cursor-pointer text-center px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide hover:text-gray-700"
                    onClick={() => handleSort('teacherCount')}>{t('columnTeachers')}{getSortIndicator('teacherCount')}</th>
                  <th className="cursor-pointer text-center px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide hover:text-gray-700"
                    onClick={() => handleSort('studentCount')}>{t('columnStudents')}{getSortIndicator('studentCount')}</th>
                  <th className="cursor-pointer text-center px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide hover:text-gray-700"
                    onClick={() => handleSort('activeLessonCount')}>{t('columnActiveLessons')}{getSortIndicator('activeLessonCount')}</th>
                  <th className="cursor-pointer text-left px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide hover:text-gray-700"
                    onClick={() => handleSort('platform_fee_percentage')}>{t('columnFee')}{getSortIndicator('platform_fee_percentage')}</th>
                  <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('columnStatus')}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((school) => (
                  <tr key={school.id} className="hover:bg-gray-50 transition">
                    <td className="px-6 py-3">
                      <Link href={`/${locale}/hq/schools/${school.id}`} className="font-medium text-gray-900 hover:text-[#6B1F3A]">
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
                        {school.active ? t('statusActive') : t('statusInactive')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={() => openEdit(school)}
                          className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 hover:border-gray-300 transition"
                        >
                          {t('buttonEdit')}
                        </button>
                        <ConfirmDeleteButton
                          label={t('buttonDelete')}
                          armedLabel={t('deleteArmedClean')}
                          onArm={() => armDelete(school)}
                          onDelete={() => handleDelete(school)}
                        />
                      </div>
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
              <h3 className="font-semibold text-gray-900 text-lg">{t('modalTitle')}</h3>
              <p className="text-sm text-gray-400 mt-0.5">{editing.name}</p>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">{t('labelSchoolName')}</label>
                  <input
                    value={form.name}
                    onChange={e => setForm(f => f && ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t('labelCity')}</label>
                  <input
                    value={form.city}
                    onChange={e => setForm(f => f && ({ ...f, city: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t('labelCountry')}</label>
                  <input
                    value={form.country}
                    onChange={e => setForm(f => f && ({ ...f, country: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">{t('labelEmail')}</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={e => setForm(f => f && ({ ...f, email: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t('labelPhone')}</label>
                  <input
                    value={form.phone}
                    onChange={e => setForm(f => f && ({ ...f, phone: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t('labelPlatformFee')}</label>
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
                  <label className="block text-xs text-gray-500 mb-1">{t('labelAddress')}</label>
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
                {saving ? t('buttonSaving') : t('buttonSaveChanges')}
              </button>
              <button
                onClick={() => { setEditing(null); setForm(null) }}
                className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition"
              >
                {t('buttonCancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
