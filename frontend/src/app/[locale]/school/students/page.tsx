'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { exportXLS, exportPDF } from '@/lib/export'
import { useTranslations, useLocale } from 'next-intl'
import { formatDate } from '@/lib/format-date'
import { useArmedAction } from '@/lib/useArmedAction'
import StudentSheet from '@/components/school/StudentSheet'
import StudentUsageModal from '@/components/school/StudentUsageModal'
import { apiFetch } from '@/lib/api/client'
import AddCreditsModal from '@/components/school/AddCreditsModal'
import ImportStudentsModal from '@/components/school/ImportStudentsModal'

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
  imported_at: string | null
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

type PasswordEmailsResult = { requested: number; sent: number; invites: number; resets: number; switched_off: number; not_found: number }

export default function SchoolStudentsPage() {
  // Suspense: `useSearchParams` lo richiede (stesso schema di school/teachers).
  return <Suspense><SchoolStudentsPageInner /></Suspense>
}

function SchoolStudentsPageInner() {
  const t = useTranslations('school.students')
  const uiLocale = useLocale()
  const tImport = useTranslations('school.studentsImport')

  const [rows, setRows] = useState<StudentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [toggling, setToggling] = useState<string | null>(null)
  const [exporting, setExporting] = useState<'xls' | 'pdf' | null>(null)
  // Import from Excel/CSV: file -> column matching -> preview -> import (ImportStudentsModal)
  const [importOpen, setImportOpen] = useState(false)

  // Bulk selection (student ids) for "Send password email". The import
  // pre-selects the students it created or enrolled, so the e-mail is one
  // deliberate click after the import instead of a side effect of it.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importedHint, setImportedHint] = useState(false)
  const [bulkMessage, setBulkMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

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
    // I18N-R3-09: the PDF title and its "Exported:" caption were English
    // for every locale.
    await exportPDF(
      EXPORT_COLUMNS, buildExportRows(), 'students', t('title'),
      t('exportedOn', { date: formatDate(new Date().toISOString()) }),
    )
    setExporting(null)
  }

  // Add Credits modal
  const [grantTarget, setGrantTarget] = useState<{ id: string; name: string } | null>(null)

  // Scheda allieva completa (profilo + documenti), la stessa che vede l'allieva.
  //
  // I18N-R3-14: si apre anche da `?student_id=<id>`. La conversazione in
  // Messaggi puntava a `/school/students/<id>`, una rotta che non esiste --
  // 404 al click e, siccome Next fa prefetch dei <Link>, un 404 in console a
  // ogni apertura del thread. Questa e' la scheda che quell'azione voleva
  // aprire: stesso id e stessa `/school/students/detail/?student_id=` che il
  // thread interroga gia' per la sidebar.
  const searchParams = useSearchParams()
  const [sheetTarget, setSheetTarget] = useState<string | null>(
    () => searchParams.get('student_id'),
  )

  // Dettaglio uso pacchetti/abbonamenti (componente condiviso StudentUsageModal)
  const [detailTarget, setDetailTarget] = useState<{ id: string; name: string } | null>(null)

  // Reset password
  const [resetting, setResetting] = useState<string | null>(null)
  const [resetOutcome, setResetOutcome] = useState<{ userId: string; sent: boolean } | null>(null)

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
    setResetOutcome(null)
    try {
      // `sent` is honest: false when that e-mail is switched off in HQ
      const res = await apiFetch<{ sent: boolean }>('/school/students/reset-password/', {
        method: 'POST',
        body: JSON.stringify({ student_user_id: s.user_id }),
      })
      setResetOutcome({ userId: s.user_id, sent: res.sent })
      setTimeout(() => setResetOutcome(null), 4000)
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

  const filteredIds = filtered.map(r => r.students?.id).filter((id): id is string => Boolean(id))
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every(id => selected.has(id))
  const someFilteredSelected = filteredIds.some(id => selected.has(id))

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllFiltered() {
    setSelected(prev => {
      const next = new Set(prev)
      if (allFilteredSelected) filteredIds.forEach(id => next.delete(id))
      else filteredIds.forEach(id => next.add(id))
      return next
    })
  }

  function clearSelection() {
    setSelected(new Set())
    setImportedHint(false)
  }

  // Two clicks + confirm before mailing a whole selection (lib/useArmedAction)
  const passwordEmails = useArmedAction(async () => {
    setBulkMessage(null)
    try {
      const res = await apiFetch<PasswordEmailsResult>('/school/students/password-emails/', {
        method: 'POST',
        body: JSON.stringify({ student_ids: [...selected] }),
      })
      const parts = [t('passwordEmailsSent', { count: res.sent, invites: res.invites, resets: res.resets })]
      if (res.switched_off > 0) parts.push(t('passwordEmailsDisabled', { count: res.switched_off }))
      setBulkMessage({ kind: 'ok', text: parts.join(' ') })
      setImportedHint(false)
    } catch {
      setBulkMessage({ kind: 'error', text: t('passwordEmailsFailed') })
    }
  }, { confirm: () => t('sendPasswordEmailsConfirm', { count: selected.size }) })

  function onImported(ids: string[]) {
    load()
    if (ids.length > 0) {
      setSelected(new Set(ids))
      setImportedHint(true)
      setBulkMessage(null)
    }
  }

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(uiLocale, { day: '2-digit', month: '2-digit', year: 'numeric' })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
          <p className="text-gray-500 text-sm mt-0.5">{rows.length} {t('enrolled')}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setImportOpen(true)}
            className="px-4 py-2 text-sm rounded-lg bg-[#6B1F3A] text-white hover:bg-[#581931] transition"
          >
            {tImport('button')}
          </button>
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

      {bulkMessage && (
        <div className={`mb-4 text-sm rounded-xl px-4 py-3 border ${bulkMessage.kind === 'ok' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {bulkMessage.text}
        </div>
      )}

      {selected.size > 0 && (
        <div className="mb-4 bg-[#6B1F3A]/5 border border-[#6B1F3A]/20 rounded-xl px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-gray-900">{t('selectedCount', { count: selected.size })}</span>
          <button
            onClick={passwordEmails.trigger}
            disabled={passwordEmails.busy}
            className={`px-3 py-1.5 text-sm rounded-lg transition disabled:opacity-50 ${passwordEmails.armed ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-[#6B1F3A] text-white hover:bg-[#581931]'}`}
          >
            {passwordEmails.busy ? t('sendingPasswordEmails') : passwordEmails.armed ? t('sendPasswordEmailsArmed') : `✉ ${t('sendPasswordEmails')}`}
          </button>
          <button onClick={clearSelection} disabled={passwordEmails.busy} className="text-sm text-gray-500 hover:text-gray-700 underline">
            {t('clearSelection')}
          </button>
          <p className="text-xs text-gray-500 basis-full">
            {importedHint ? t('importedSelectedHint') : t('sendPasswordEmailsHint')}
          </p>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">{t('loading')}</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">{t('noStudents')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label={t('selectAll')}
                    title={t('selectAll')}
                    checked={allFilteredSelected}
                    ref={el => { if (el) el.indeterminate = someFilteredSelected && !allFilteredSelected }}
                    onChange={toggleAllFiltered}
                    className="accent-[#6B1F3A] cursor-pointer"
                  />
                </th>
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
                const isSelected = selected.has(s.id)
                return (
                  <tr key={row.id} className={`transition ${isSelected ? 'bg-[#6B1F3A]/5' : 'hover:bg-gray-50'}`}>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={t('selectRow', { name: s.name })}
                        checked={isSelected}
                        onChange={() => toggleOne(s.id)}
                        className="accent-[#6B1F3A] cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{s.name}</p>
                      <p className="text-xs text-gray-400">{s.email}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-sm">
                      {s.phone ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{s.city ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                      {fmtDate(row.enrolled_at)}
                      {row.imported_at && (
                        <p className="text-[11px] text-[#6B1F3A]/70 mt-0.5">{t('importedOn', { date: fmtDate(row.imported_at) })}</p>
                      )}
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
                          {resetting === s.user_id ? '...'
                            : resetOutcome?.userId === s.user_id ? (resetOutcome.sent ? `✓ ${t('resetSent')}` : t('resetNotSent'))
                            : t('resetPwd')}
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

      {importOpen && (
        <ImportStudentsModal onClose={() => setImportOpen(false)} onDone={onImported} />
      )}
    </div>
  )
}
