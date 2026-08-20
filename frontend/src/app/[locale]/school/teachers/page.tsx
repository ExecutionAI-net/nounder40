'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import ConfirmDeleteButton from '@/components/ui/ConfirmDeleteButton'
import PhoneInput from '@/components/ui/PhoneInput'
import { apiFetch, ApiError } from '@/lib/api/client'

interface TeacherRow {
  teacher_id: string
  active: boolean
  teachers: { id: string; name: string; email: string; phone: string | null; active: boolean; created_at: string } | null
}

export default function SchoolTeachersPage() {
  return <Suspense><TeachersPageInner /></Suspense>
}

function TeachersPageInner() {
  const t = useTranslations('school.teachers')
  const searchParams = useSearchParams()
  const [rows, setRows]       = useState<TeacherRow[]>([])
  const [loading, setLoading] = useState(true)
  const [success, setSuccess] = useState<string | null>(null)
  const [resendingId, setResendingId] = useState<string | null>(null)
  // Edit teacher modal
  const [editTarget, setEditTarget] = useState<{ id: string; email: string } | null>(null)
  const [editForm, setEditForm] = useState({ name: '', phone: '', email: '' })
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  useEffect(() => {
    const added = searchParams.get('added')
    if (added) {
      const emailSent = searchParams.get('emailSent') !== '0'
      setSuccess(emailSent ? t('addedWithEmail', { name: added }) : t('addedNoEmail', { name: added }))
    }
    fetchData()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchData() {
    try {
      const data = await apiFetch<{ teachers: TeacherRow[]; pending: unknown[] }>('/school/teachers/')
      setRows(Array.isArray(data.teachers) ? data.teachers : [])
    } catch {
      setRows([])
    }
    setLoading(false)
  }

  async function resendInvite(teacherId: string, name: string) {
    setResendingId(teacherId)
    try {
      await apiFetch('/school/teachers/resend/', { method: 'POST', body: JSON.stringify({ teacher_id: teacherId }) })
      setSuccess(`Invitation resent to ${name}.`)
    } catch (err) {
      const errCode = err instanceof ApiError && typeof err.body === 'object' && err.body
        ? (err.body as { error?: string }).error : undefined
      setSuccess(`Error: ${errCode ?? 'Failed to resend'}`)
    }
    setResendingId(null)
  }

  async function removeTeacher(teacherId: string) {
    await apiFetch('/school/teachers/', { method: 'DELETE', body: JSON.stringify({ teacher_id: teacherId }) }).catch(() => {})
    await fetchData()
  }

  async function handleEditSave(e: React.FormEvent) {
    e.preventDefault()
    if (!editTarget) return
    setEditSaving(true)
    setEditError(null)
    try {
      await apiFetch(`/school/teachers/${editTarget.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editForm.name, phone: editForm.phone, email: editForm.email }),
      })
      setEditTarget(null)
      setSuccess(t('teacherUpdated'))
      await fetchData()
    } catch (err) {
      const errCode = err instanceof ApiError && typeof err.body === 'object' && err.body
        ? (err.body as { error?: string }).error : undefined
      setEditError(errCode ?? 'Error')
    }
    setEditSaving(false)
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
          <p className="text-gray-500 text-sm mt-1">{rows.length} {t('teacherCount', { count: rows.length })}</p>
        </div>
        <Link href="/school/teachers/invite"
          className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition">
          {t('addTeacher')}
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
          <div className="p-8 text-center text-gray-400 text-sm">{t('loading')}</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">
            {t('noTeachers')}{' '}
            <Link href="/school/teachers/invite" className="text-[#6B1F3A] hover:underline">
              {t('addFirstTeacher')}
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('colTeacher')}</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('colPhone')}</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('colStatus')}</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(row => {
                const teacher = row.teachers
                if (!teacher) return null
                return (
                  <tr key={row.teacher_id} className="hover:bg-gray-50 transition">
                    <td className="px-6 py-3">
                      <p className="font-medium text-gray-900">{teacher.name}</p>
                      <p className="text-xs text-gray-400">{teacher.email}</p>
                    </td>
                    <td className="px-6 py-3 text-gray-600">{teacher.phone ?? '—'}</td>
                    <td className="px-6 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${teacher.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {teacher.active ? t('active') : t('inactive')}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => { setEditTarget({ id: row.teacher_id, email: teacher.email }); setEditForm({ name: teacher.name, phone: teacher.phone ?? '', email: teacher.email }); setEditError(null) }}
                          className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 transition">
                          {t('edit')}
                        </button>
                        <button
                          onClick={() => resendInvite(row.teacher_id, teacher.name)}
                          disabled={resendingId === row.teacher_id}
                          className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 transition disabled:opacity-50 whitespace-nowrap">
                          {resendingId === row.teacher_id ? t('sending') : t('resendInvite')}
                        </button>
                        <ConfirmDeleteButton
                          label={t('remove')}
                          armedLabel={t('removeArmed')}
                          onDelete={() => removeTeacher(row.teacher_id)}
                          className="text-red-400 hover:text-red-600 border-0 px-0"
                        />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="px-6 pt-6 pb-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 text-lg">{t('modalEditTitle')}</h3>
              <p className="text-sm text-gray-400 mt-0.5">{editTarget.email}</p>
            </div>
            <form onSubmit={handleEditSave} className="px-6 py-5 space-y-4">
              {editError && <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg">{editError}</div>}
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t('labelName')}</label>
                <input value={editForm.name} required
                  onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t('labelEmail')}</label>
                <input type="email" value={editForm.email} required
                  onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20" />
                <p className="text-xs text-gray-400 mt-1">{t('emailChangeHint')}</p>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t('labelPhone')}</label>
                <PhoneInput value={editForm.phone}
                  onChange={phone => setEditForm(f => ({ ...f, phone }))}
                  inputClassName="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20" />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="submit" disabled={editSaving || !editForm.name.trim()}
                  className="flex-1 py-2.5 bg-[#6B1F3A] text-white rounded-xl text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50">
                  {editSaving ? t('saving') : t('save')}
                </button>
                <button type="button" onClick={() => setEditTarget(null)}
                  className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition">
                  {t('cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <p className="text-xs text-gray-400 mt-4">
        {t('compensationNote')}
      </p>
    </div>
  )
}
