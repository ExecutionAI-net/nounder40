'use client'

import { useEffect, useState } from 'react'
import { exportXLS, exportPDF } from '@/lib/export'
import { useTranslations, useLocale } from 'next-intl'
import { formatDate } from '@/lib/format-date'
import PhoneInput from '@/components/ui/PhoneInput'
import StudentUsageModal from '@/components/school/StudentUsageModal'

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

  const REASONS = [
    { value: 'gift', label: t('reasonGift') },
    { value: 'refund', label: t('reasonRefund') },
    { value: 'correction', label: t('reasonCorrection') },
    { value: 'compensation', label: t('reasonCompensation') },
    { value: 'other', label: t('reasonOther') },
  ]
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
  const [grantForm, setGrantForm] = useState({ amount: '', reason: 'gift', note: '', expires_at: '', package_catalog_id: '', price: '', payment_method: 'cash' })
  const [granting, setGranting] = useState(false)
  const [grantError, setGrantError] = useState<string | null>(null)
  const [grantSuccess, setGrantSuccess] = useState(false)
  const [schoolPackages, setSchoolPackages] = useState<{ id: string; name_en: string; credits: number; validity_days: number; price: number; active: boolean }[]>([])

  // Edit student modal
  const [editTarget, setEditTarget] = useState<{ user_id: string; name: string; phone: string | null } | null>(null)
  const [editForm, setEditForm] = useState({ name: '', phone: '', email: '' })
  const [editing, setEditing] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Dettaglio uso pacchetti/abbonamenti (componente condiviso StudentUsageModal)
  const [detailTarget, setDetailTarget] = useState<{ id: string; name: string } | null>(null)

  // Reset password
  const [resetting, setResetting] = useState<string | null>(null)
  const [resetSuccess, setResetSuccess] = useState<string | null>(null)

  async function load() {
    const res = await fetch('/api/school/students', { cache: 'no-store' })
    const data = await res.json()
    setRows(Array.isArray(data) ? data : [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    fetch('/api/school/packages', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setSchoolPackages(Array.isArray(d) ? d.filter((p: { active: boolean }) => p.active) : []))
  }, [])

  async function toggleFreeLesson(row: StudentRow, value: boolean) {
    setToggling(row.id)
    await fetch('/api/school/students', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ school_student_id: row.id, free_lesson_used: value }),
    })
    await load()
    setToggling(null)
  }

  async function handleGrant() {
    if (!grantTarget || !grantForm.amount || !grantForm.reason) return
    setGranting(true)
    setGrantError(null)

    const res = await fetch('/api/school/credits/grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_id: grantTarget.id,
        amount: Number(grantForm.amount),
        reason: grantForm.reason,
        note: grantForm.note || null,
        expires_at: grantForm.expires_at || null,
        package_catalog_id: grantForm.package_catalog_id || null,
        price: grantForm.price ? Number(grantForm.price) : null,
        payment_method: grantForm.payment_method,
      }),
    })

    const data = await res.json()
    if (!res.ok) {
      setGrantError(data.error)
      setGranting(false)
      return
    }

    setGrantSuccess(true)
    setGranting(false)
    setTimeout(() => {
      setGrantTarget(null)
      setGrantSuccess(false)
      setGrantForm({ amount: '', reason: 'gift', note: '', expires_at: '', package_catalog_id: '', price: '', payment_method: 'cash' })
    }, 1500)
  }

  function openEdit(s: NonNullable<StudentRow['students']>) {
    setEditTarget({ user_id: s.user_id, name: s.name, phone: s.phone })
    setEditForm({ name: s.name, phone: s.phone ?? '', email: s.email ?? '' })
    setEditError(null)
  }

  async function handleEdit() {
    if (!editTarget) return
    setEditing(true)
    setEditError(null)
    const res = await fetch('/api/school/students', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_user_id: editTarget.user_id,
        name: editForm.name,
        phone: editForm.phone || null,
        email: editForm.email,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      setEditError(data.error)
      setEditing(false)
      return
    }
    setEditing(false)
    setEditTarget(null)
    await load()
  }

  async function handleResetPassword(s: NonNullable<StudentRow['students']>) {
    setResetting(s.user_id)
    setResetSuccess(null)
    const res = await fetch('/api/school/students/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_user_id: s.user_id }),
    })
    if (res.ok) {
      setResetSuccess(s.user_id)
      setTimeout(() => setResetSuccess(null), 3000)
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
                          onClick={() => openEdit(s)}
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

      {/* Edit Student Modal */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <div>
              <h3 className="font-semibold text-gray-900 text-base">{t('editStudentTitle')}</h3>
              <p className="text-sm text-gray-400 mt-0.5">{editTarget.name}</p>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">{t('labelName')}</label>
                <input
                  value={editForm.name}
                  onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">{t('labelEmail')}</label>
                <input
                  type="email" required
                  value={editForm.email}
                  onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20"
                />
                <p className="text-xs text-gray-400 mt-1">{t('emailChangeHint')}</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">{t('labelPhone')}</label>
                <PhoneInput
                  value={editForm.phone}
                  onChange={phone => setEditForm(f => ({ ...f, phone }))}
                  inputClassName="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20"
                />
              </div>
            </div>
            {editError && <p className="text-sm text-red-600">{editError}</p>}
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleEdit}
                disabled={editing || !editForm.name}
                className="flex-1 px-4 py-2.5 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700 disabled:opacity-50 transition"
              >
                {editing ? t('saving') : t('saveChanges')}
              </button>
              <button
                onClick={() => setEditTarget(null)}
                className="px-4 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition"
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Credits Modal */}
      {grantTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <div>
              <h3 className="font-semibold text-gray-900 text-base">{t('addCreditsTitle')}</h3>
              <p className="text-sm text-gray-400 mt-0.5">{t('studentLabel')}: <span className="font-medium text-gray-700">{grantTarget.name}</span></p>
            </div>

            {grantSuccess ? (
              <div className="py-4 text-center text-green-600 font-medium text-sm">
                ✓ Credits added successfully
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t('labelAmount')}</label>
                    <input
                      type="number"
                      min="1"
                      value={grantForm.amount}
                      onChange={e => setGrantForm(f => ({ ...f, amount: e.target.value }))}
                      placeholder={t('amountPlaceholder')}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t('labelReason')}</label>
                    <select
                      value={grantForm.reason}
                      onChange={e => setGrantForm(f => ({ ...f, reason: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20"
                    >
                      {REASONS.map(r => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </div>

                  {schoolPackages.length > 0 && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        {t('creditPackage')} <span className="text-gray-400 font-normal">({t('optional')})</span>
                      </label>
                      <select
                        value={grantForm.package_catalog_id}
                        onChange={e => {
                          const pkgId = e.target.value
                          const pkg = schoolPackages.find(p => p.id === pkgId)
                          setGrantForm(f => ({
                            ...f,
                            package_catalog_id: pkgId,
                            amount: pkg ? String(pkg.credits) : f.amount,
                            price: pkg ? String(pkg.price) : f.price,
                          }))
                        }}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20"
                      >
                        <option value="">{t('noPackageManualGrant')}</option>
                        {schoolPackages.map(p => (
                          <option key={p.id} value={p.id}>{p.name_en} ({p.credits} credits)</option>
                        ))}
                      </select>
                      <p className="text-xs text-gray-400 mt-1">{t('packageAutoFill')}</p>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      {t('expiryDate')} <span className="text-gray-400 font-normal">({t('onlyIfNoPackage')})</span>
                    </label>
                    <input
                      type="date"
                      value={grantForm.expires_at}
                      disabled={!!grantForm.package_catalog_id}
                      onChange={e => setGrantForm(f => ({ ...f, expires_at: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20 disabled:opacity-40 disabled:cursor-not-allowed"
                    />
                    <p className="text-xs text-gray-400 mt-1">{grantForm.package_catalog_id ? t('expiryFromPackage') : t('leaveBlankNoExpiry')}</p>
                  </div>

                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        {t('pricePaid')} <span className="text-gray-400 font-normal">(€, {t('optional')})</span>
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={grantForm.price}
                        onChange={e => setGrantForm(f => ({ ...f, price: e.target.value }))}
                        placeholder={t('pricePlaceholder')}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-600 mb-1">{t('paymentMethod')}</label>
                      <select
                        value={grantForm.payment_method}
                        onChange={e => setGrantForm(f => ({ ...f, payment_method: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20"
                      >
                        <option value="cash">{t('methodCash')}</option>
                        <option value="bank_transfer">{t('methodBankTransfer')}</option>
                        <option value="pos">{t('methodPOS')}</option>
                        <option value="other">{t('methodOther')}</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t('note')} <span className="text-gray-400 font-normal">({t('optional')})</span></label>
                    <textarea
                      value={grantForm.note}
                      onChange={e => setGrantForm(f => ({ ...f, note: e.target.value }))}
                      placeholder={t('notePlaceholder')}
                      rows={2}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20 resize-none"
                    />
                  </div>
                </div>

                {grantError && (
                  <p className="text-sm text-red-600">{grantError}</p>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleGrant}
                    disabled={granting || !grantForm.amount || Number(grantForm.amount) <= 0}
                    className="flex-1 px-4 py-2.5 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700 disabled:opacity-50 transition"
                  >
                    {granting ? t('adding') : t('addCreditsTitle')}
                  </button>
                  <button
                    onClick={() => {
                      setGrantTarget(null)
                      setGrantError(null)
                      setGrantForm({ amount: '', reason: 'gift', note: '', expires_at: '', package_catalog_id: '', price: '', payment_method: 'cash' })
                    }}
                    className="px-4 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition"
                  >
                    {t('cancel')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
