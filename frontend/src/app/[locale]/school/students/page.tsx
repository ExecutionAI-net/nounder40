'use client'

import { useEffect, useState } from 'react'
import { exportXLS, exportPDF } from '@/lib/export'
import { useTranslations, useLocale } from 'next-intl'
import { formatDate } from '@/lib/format-date'
import StudentSheet from '@/components/school/StudentSheet'
import StudentUsageModal from '@/components/school/StudentUsageModal'
import { apiFetch } from '@/lib/api/client'
import AddCreditsModal from '@/components/school/AddCreditsModal'

interface StudentPackageSummary {
  name: string
  credits: number
  expires_at: string
}

interface StudentSubSummary {
  name: string
}

interface StudentRow {
  id: string
  enrolled_at: string
  free_lesson_used: boolean
  packages: StudentPackageSummary[]
  subscriptions: StudentSubSummary[]
  students: {
    id: string
    user_id: string
    name: string
    email: string
    phone: string | null
    city: string | null
    created_at: string
  } | null
}

export default function SchoolStudentsPage() {
  const t = useTranslations('school.students')
  const uiLocale = useLocale()

  const [rows, setRows] = useState<StudentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [toggling, setToggling] = useState<string | null>(null)
  const [exporting, setExporting] = useState<'xls' | 'pdf' | null>(null)

  const EXPORT_COLUMNS = [
    { header: t('colName'), key: 'name', width: 25 },
    { header: t('colEmail'), key: 'email', width: 30 },
    { header: t('colCity'), key: 'city', width: 20 },
    { header: t('colPhone'), key: 'phone', width: 18 },
    { header: t('colEnrolled'), key: 'enrolled_at', width: 18 },
    { header: t('colFreeLesson'), key: 'free_lesson', width: 15 },
  ]

  function buildExportRows() {
    return filtered.map(r => ({
      name: r.students?.name ?? '',
      email: r.students?.email ?? '',
      city: r.students?.city ?? '',
      phone: r.students?.phone ?? '',
      enrolled_at: formatDate(r.enrolled_at),
      free_lesson: r.free_lesson_used ? t('freeLessonUsed') : t('freeLessonAvailable'),
    }))
  }

  async function handleExportXLS() {
    setExporting('xls')
    await exportXLS(EXPORT_COLUMNS, buildExportRows(), 'students')
    setExporting(null)
  }

  async function handleExportPDF() {
    setExporting('pdf')
    await exportPDF(EXPORT_COLUMNS, buildExportRows(), 'students', 'Students List')
    setExporting(null)
  }

  // Add Credits modal
  const [grantTarget, setGrantTarget] = useState<{ id: string; name: string } | null>(null)

  // Scheda allieva completa (profilo + documenti), la stessa che vede l'allieva
  const [sheetTarget, setSheetTarget] = useState<string | null>(null)

  // Dettaglio uso pacchetti/abbonamenti (componente condiviso StudentUsageModal)
  const [detailTarget, setDetailTarget] = useState<{ id: string; name: string } | null>(null)

  // Reset password
  const [resetting, setResetting] = useState<string | null>(null)
  const [resetSuccess, setResetSuccess] = useState<string | null>(null)

  async function load() {
    try {
      setRows(await apiFetch<StudentRow[]>('/school/students/'))
    } catch {
      setRows([])
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])


  async function toggleFreeLesson(row: StudentRow, value: boolean) {
    setToggling(row.id)
    await apiFetch('/school/students/', {
      method: 'PATCH',
      body: JSON.stringify({ school_student_id: row.id, free_lesson_used: value }),
    }).catch(() => {})
    await load()
    setToggling(null)
  }

  async function handleResetPassword(s: NonNullable<StudentRow['students']>) {
    setResetting(s.user_id)
    setResetSuccess(null)
    try {
      await apiFetch('/school/students/reset-password/', {
        method: 'POST',
        body: JSON.stringify({ student_user_id: s.user_id }),
      })
      setResetSuccess(s.user_id)
      setTimeout(() => setResetSuccess(null), 3000)
    } catch {
      // no-op
    }
    setResetting(null)
  }

  const filtered = rows.filter(r => {
    if (!search) return true
    const s = r.students
    if (!s) return false
    return (
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.email.toLowerCase().includes(search.toLowerCase()) ||
      (s.city ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (s.phone ?? '').toLowerCase().includes(search.toLowerCase())
    )
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
          <p className="text-gray-500 text-sm mt-0.5">{rows.length} {t('enrolled')}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExportXLS}
            disabled={exporting === 'xls' || filtered.length === 0}
            className="px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition"
          >
            {exporting === 'xls' ? t('exporting') : t('exportXls')}
          </button>
          <button
            onClick={handleExportPDF}
            disabled={exporting === 'pdf' || filtered.length === 0}
            className="px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition"
          >
            {exporting === 'pdf' ? t('exporting') : t('exportPdf')}
          </button>
        </div>
      </div>

      <div className="mb-4">
        <input
          placeholder={t('searchPlaceholder')}
          className="w-full max-w-sm border border-gray-200 rounded-lg px-3 py-2 text-sm"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">{t('loading')}</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">{t('noStudents')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{t('colName')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{t('colPhone')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{t('colCity')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{t('colEnrolled')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{t('colPackagesSubs')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{t('colFreeLesson')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{t('colActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(row => {
                const s = row.students
                if (!s) return null
                return (
                  <tr key={row.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{s.name}</p>
                      <p className="text-xs text-gray-400">{s.email}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-sm">
                      {s.phone ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{s.city ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                      {new Date(row.enrolled_at).toLocaleDateString(uiLocale, { day: '2-digit', month: '2-digit', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {row.packages.map((p, i) => (
                          <span key={i} className="text-xs bg-[#6B1F3A]/10 text-[#6B1F3A] px-2 py-0.5 rounded-full font-medium whitespace-nowrap">
                            {p.name} · {p.credits}cr
                          </span>
                        ))}
                        {row.subscriptions.map((s, i) => (
                          <span key={i} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium whitespace-nowrap">
                            {s.name}
                          </span>
                        ))}
                        {row.packages.length === 0 && row.subscriptions.length === 0 && (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={row.free_lesson_used ? 'used' : 'available'}
                        disabled={toggling === row.id}
                        onChange={e => toggleFreeLesson(row, e.target.value === 'used')}
                        className={`text-xs font-medium rounded-full px-2.5 py-1 border-0 cursor-pointer disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-gray-300 ${
                          row.free_lesson_used
                            ? 'bg-gray-100 text-gray-500'
                            : 'bg-green-100 text-green-700'
                        }`}
                      >
                        <option value="available">{t('freeLessonAvailable')}</option>
                        <option value="used">{t('freeLessonUsed')}</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5 flex-wrap">
                        {/* Edit */}
                        <button
                          onClick={() => setSheetTarget(s.id)}
                          className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition"
                        >
                          {t('edit')}
                        </button>
                        {/* Reset Password */}
                        <button
                          onClick={() => handleResetPassword(s)}
                          disabled={resetting === s.user_id}
                          className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition"
                        >
                          {resetting === s.user_id ? '...' : resetSuccess === s.user_id ? '✓ Sent' : t('resetPwd')}
                        </button>
                        {/* Add Credits */}
                        <button
                          onClick={() => setDetailTarget({ id: s.id, name: s.name })}
                          className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 transition whitespace-nowrap">
                          {t('detailButton')}
                        </button>
                        <button
                          onClick={() => setGrantTarget({ id: s.id, name: s.name })}
                          className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition"
                        >
                          {t('addCredits')}
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

      {/* Dettaglio uso pacchetti/abbonamenti — componente condiviso */}
      {detailTarget && (
        <StudentUsageModal studentId={detailTarget.id} studentName={detailTarget.name} onClose={() => setDetailTarget(null)} />
      )}

      {/* Scheda allieva: profilo modificabile + documenti, come la vede l'allieva */}
      {sheetTarget && (
        <StudentSheet
          studentId={sheetTarget}
          editable
          onClose={() => setSheetTarget(null)}
          onChanged={load}
        />
      )}

      {grantTarget && (
        <AddCreditsModal
          student={grantTarget}
          onClose={() => setGrantTarget(null)}
          onDone={load}
        />
      )}
    </div>
  )
}
