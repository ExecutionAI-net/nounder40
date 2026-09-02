'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import ConfirmDeleteButton from '@/components/ui/ConfirmDeleteButton'
import ErrorBanner from '@/components/ui/ErrorBanner'
import { apiFetch, ApiError } from '@/lib/api/client'

type EditableSchool = {
  id: string
  name: string
  city: string
  country: string | null
  email: string
  phone: string | null
  address: string | null
  address_line2: string | null
  province: string | null
  vat_number: string | null
  website: string | null
  platform_fee_percentage: number
  shop_commission_percentage?: number | null
}

type School = EditableSchool & {
  active: boolean
  created_at: string
  teacherCount: number
  studentCount: number
  activeLessonCount: number
}

type SortKey = 'name' | 'city' | 'teacherCount' | 'studentCount' | 'activeLessonCount' | 'platform_fee_percentage' | 'created_at'

export default function SchoolsPage() {
  const t = useTranslations('hq.schools')
  const locale = useLocale()
  const [schools, setSchools] = useState<School[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDesc, setSortDesc] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // First click: fetch linked records → build the "are you sure" label.
  // Blocked (financial records) → show error banner, don't arm.
  async function armDelete(school: School): Promise<string | null> {
    setDeleteError(null)
    let cascading, blocking
    try {
      ({ cascading, blocking } = await apiFetch<{ cascading: Record<string, number>; blocking: Record<string, number> }>(`/hq/schools/${school.id}/linked/`))
    } catch {
      setDeleteError(t('errorSaveFailed')); return null
    }
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
    try {
      await apiFetch(`/hq/schools/${school.id}/`, { method: 'DELETE' })
      load()
    } catch (err) {
      const body = err instanceof ApiError ? err.body as { error?: string; linked?: { blocking?: { transactions?: number; shopOrders?: number } } } : null
      setDeleteError(
        body?.error === 'has_financial_records'
          ? t('deleteBlockedFinancial', { name: school.name, count: (body.linked?.blocking?.transactions ?? 0) + (body.linked?.blocking?.shopOrders ?? 0) })
          : body?.error ?? t('errorSaveFailed')
      )
    }
  }

  async function load() {
    try {
      setSchools(await apiFetch<School[]>('/hq/schools/'))
    } catch { /* no-op */ }
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
        <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
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
                    <td className="px-6 py-3 whitespace-nowrap">
                      <Link href={`/${locale}/hq/schools/${school.id}`} className="font-medium text-gray-900 hover:text-[#6B1F3A]">
                        {school.name}
                      </Link>
                      <p className="text-xs text-gray-400">{school.email}</p>
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {school.city}{school.country ? `, ${school.country}` : ''}
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <span className="text-sm font-semibold text-gray-900">{school.teacherCount}</span>
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <span className="text-sm font-semibold text-gray-900">{school.studentCount}</span>
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <span className="text-sm font-semibold text-gray-900">{school.activeLessonCount}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{school.platform_fee_percentage}%</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${school.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {school.active ? t('statusActive') : t('statusInactive')}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2 justify-end">
                        <Link
                          href={`/${locale}/hq/schools/${school.id}/edit?from=list`}
                          className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 hover:border-gray-300 transition"
                        >
                          {t('buttonEdit')}
                        </Link>
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

    </div>
  )
}
