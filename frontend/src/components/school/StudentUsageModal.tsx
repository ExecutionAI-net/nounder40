'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { apiFetch, ApiError } from '@/lib/api/client'
import { localizedName, type TranslatedNames } from '@/lib/localized-name'
import { placeLabel } from '@/lib/lesson-format'
import { useSchoolSectionAllowed } from '@/lib/school-permissions'

// Shared school-side modal for package usage, in two modes:
//  - student (Students → "Package usage"): ACTIVE packages only, each with
//    "Usage details →" that drills into the package ("←" comes back). Past
//    packages live in Reports → Packages filtered by student: link at the end.
//  - package (Reports → Bookings on the Source cell, Reports → Packages on
//    the row): one package with the bookings paid with it, i.e. its credit
//    ledger (a booking draws on exactly one package, a refund goes back to it),
//    plus the school's own movements on it: lessons taken off by hand, with an
//    internal note, and their undo. The "Deduct lessons" form lives here too
//    (section manualCredits, the same permission as a manual grant); after a
//    movement `onChanged` tells the page behind to reload its balances.
// One view at a time, so the modal never grows with the years of purchases.
// Endpoints: /api/school/student-usage/, /api/school/student-usage/packages/<id>/,
// /api/school/credits/deduct/, /api/school/credits/deductions/<id>/reverse/.

type PackageCard = {
  id: string
  name: TranslatedNames
  credits_total: number | string
  credits_remaining: number | string
  purchased_at: string
  expires_at: string | null
  status: string
  // Credits told as lessons when the package has one per-lesson cost (the
  // same rule as the student's own page); null = credits only (mixed types,
  // unlimited, manual credits without a catalog row, too small for a lesson).
  lesson_credit_cost: string | null
  lessons_total: number | null
  lessons_remaining: number | null
}

type PackageBooking = {
  id: string
  status: string
  credits_deducted: number | string
  credit_refunded: boolean
  booked_at: string
  lesson_date: string
  start_time: string | null
  course_name: string
  lesson_type: TranslatedNames
  is_online: boolean
  location_name: string
  room_name: string
}

// A hand-made movement on the package: a deduction by the school, or the
// reversal that undid one. `lessons` when the amount is a whole number of
// lessons at the package's cost, else credits only.
type PackageMovement = {
  id: string
  kind: 'deduction' | 'reversal'
  amount: number | string
  lessons: number | null
  note: string
  by: string
  at: string
  reversed: boolean
  reverses: string | null
}

type StudentUsage = { student: { id: string; name: string }; packages: PackageCard[] }
type PackageUsage = {
  student: { id: string; name: string }
  package: PackageCard
  bookings: PackageBooking[]
  movements: PackageMovement[]
}

// Student mode needs the student; package mode needs the package and may
// carry the student to come back to (the drill-down from student mode).
type Target =
  | { studentId: string; studentPackageId?: undefined }
  | { studentPackageId: string; studentId?: string }

const PILL = 'text-xs px-2 py-0.5 rounded-full shrink-0'
const EPS = 1e-9 // credits are half-credit steps: exact in floating point, the epsilon is belt and braces

// Backend error codes of the two movement endpoints → message keys. Anything
// else (a 403, a network error) is the generic one.
const MOVEMENT_ERROR_KEYS: Record<string, 'detailDeductTooMany' | 'detailDeductNotActive' | 'detailAlreadyReversed'> = {
  amount_exceeds_remaining: 'detailDeductTooMany',
  package_not_active: 'detailDeductNotActive',
  already_reversed: 'detailAlreadyReversed',
}

export default function StudentUsageModal(props: Target & { studentName: string; onClose: () => void; onChanged?: () => void }) {
  const { studentId, studentPackageId, studentName, onClose, onChanged } = props
  const t = useTranslations('school.students')
  const uiLocale = useLocale()
  const reportsAllowed = useSchoolSectionAllowed('reports')
  const manualCreditsAllowed = useSchoolSectionAllowed('manualCredits')
  // The open package: the caller's, or the one picked from the active list.
  // null = the active list (student mode only).
  const [openPackageId, setOpenPackageId] = useState<string | null>(studentPackageId ?? null)
  // The same id, readable from a refresh that resolves after the user has
  // moved on: its response must then be dropped, not shown.
  const openIdRef = useRef<string | null>(studentPackageId ?? null)
  const [student, setStudent] = useState<StudentUsage | null>(null)
  const [studentFailed, setStudentFailed] = useState(false)
  const [pkg, setPkg] = useState<PackageUsage | null>(null)
  const [pkgFailed, setPkgFailed] = useState(false)
  // "Deduct lessons" form: quantity in lessons or credits (see inLessons),
  // note for the school only. Busy while a deduction or a reversal runs.
  const [deductQty, setDeductQty] = useState('')
  const [deductNote, setDeductNote] = useState('')
  const [deductBusy, setDeductBusy] = useState(false)
  const [deductError, setDeductError] = useState<string | null>(null)

  useEffect(() => {
    if (!studentId) return
    let alive = true
    setStudentFailed(false)
    apiFetch<StudentUsage>(`/school/student-usage/?student_id=${studentId}`)
      .then(d => { if (alive) setStudent(d) })
      .catch(() => { if (alive) setStudentFailed(true) })
    return () => { alive = false }
  }, [studentId])

  useEffect(() => {
    // Reset on every change, so going back after a failed package load shows
    // the (already loaded) list again and a late response never leaks.
    openIdRef.current = openPackageId
    setPkg(null)
    setPkgFailed(false)
    setDeductQty('')
    setDeductNote('')
    setDeductError(null)
    if (!openPackageId) return
    let alive = true
    apiFetch<PackageUsage>(`/school/student-usage/packages/${openPackageId}/`)
      .then(d => { if (alive) setPkg(d) })
      .catch(() => { if (alive) setPkgFailed(true) })
    return () => { alive = false }
  }, [openPackageId])

  const fmtD = (d: string) => new Date(d).toLocaleDateString(uiLocale, { day: 'numeric', month: 'short', year: 'numeric' })
  const fmtLesson = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(uiLocale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  const pkgName = (p: PackageCard) => localizedName(p.name, uiLocale, t('detailPackage'))
  const pkgStatus = (st: string) => t(st === 'active' ? 'statusActive' : st === 'expired' ? 'statusExpired' : 'statusExhausted')
  const bookingStatus = (st: string) =>
    t(st === 'attended' ? 'bookingAttended' : st === 'no_show' ? 'bookingNoShow' : st === 'cancelled' ? 'bookingCancelled' : 'bookingConfirmed')
  const bookingPill = (st: string) =>
    st === 'attended' ? 'bg-green-100 text-green-700'
      : st === 'no_show' ? 'bg-red-100 text-red-600'
      : st === 'cancelled' ? 'bg-gray-200 text-gray-500'
      : 'bg-blue-50 text-blue-600'
  // "📍 location · room" or "💻 Online" after date and time, the same line the
  // student sees on her own packages page; nothing when the lesson has no room.
  const placeSuffix = (b: PackageBooking) => {
    const place = placeLabel(b, t('detailOnline'))
    return place ? ` · ${place}` : ''
  }
  // A movement's size: lessons when it is a whole number of them, else credits.
  const movementQty = (m: PackageMovement) =>
    m.lessons != null ? t('detailLessonsQty', { count: m.lessons }) : t('creditsCount', { count: Number(m.amount) })

  const inPackage = openPackageId !== null
  const failed = inPackage ? pkgFailed : studentFailed
  const loading = !failed && (inPackage ? !pkg : !student)

  // The form asks lessons when the package is told in lessons AND at least
  // one is left; with a leftover below one lesson ("0 lessons left · 1.0
  // credits") it asks credits, so that leftover can still be taken off.
  // Only on an active package with something left, and only for a role
  // that may grant credits.
  const card = pkg?.package ?? null
  const inLessons = card?.lessons_remaining != null && card.lessons_remaining > 0
  const maxQty = card ? (inLessons ? card.lessons_remaining ?? 0 : Number(card.credits_remaining)) : 0
  const canDeduct = manualCreditsAllowed !== false && card !== null && card.status === 'active' && Number(card.credits_remaining) > 0

  // After a movement — or a refused one, the balance may have moved under
  // us — both views are stale: the package (ledger, card) and, in student
  // mode, the active list behind the "←". Quiet refreshes: a failure here
  // keeps what is on screen instead of replacing it with an error, and a
  // response for a package the user has since left is dropped.
  async function refreshAfterMovement() {
    const id = openIdRef.current
    if (id) {
      try {
        const d = await apiFetch<PackageUsage>(`/school/student-usage/packages/${id}/`)
        if (openIdRef.current === id) setPkg(d)
      } catch { /* keep the current view */ }
    }
    if (studentId) {
      try {
        setStudent(await apiFetch<StudentUsage>(`/school/student-usage/?student_id=${studentId}`))
      } catch { /* keep the current list */ }
    }
  }

  function movementErrorKey(err: unknown) {
    const code = err instanceof ApiError && typeof err.body === 'object' && err.body && 'error' in err.body
      ? String((err.body as { error: unknown }).error) : ''
    return MOVEMENT_ERROR_KEYS[code] ?? 'detailDeductError'
  }

  async function submitDeduction() {
    if (!card || deductBusy) return
    const qty = Number(deductQty.replace(',', '.'))
    if (!(qty > 0) || qty > maxQty + EPS || (inLessons ? !Number.isInteger(qty) : Math.abs(qty * 2 - Math.round(qty * 2)) > EPS)) {
      setDeductError(t('detailDeductTooMany'))
      return
    }
    setDeductBusy(true)
    setDeductError(null)
    try {
      await apiFetch('/school/credits/deduct/', {
        method: 'POST',
        body: JSON.stringify({
          student_package_id: card.id,
          // Lessons as an integer; credits as a string, so "0.5" reaches the
          // backend as an exact decimal (same as the grant modal).
          ...(inLessons ? { lessons: Math.round(qty) } : { amount: deductQty.replace(',', '.').trim() }),
          note: deductNote.trim(),
        }),
      })
      setDeductQty('')
      setDeductNote('')
      await refreshAfterMovement()
      onChanged?.()
    } catch (err) {
      setDeductError(t(movementErrorKey(err)))
      await refreshAfterMovement()
    } finally {
      setDeductBusy(false)
    }
  }

  async function reverseDeduction(movementId: string) {
    if (deductBusy) return
    setDeductBusy(true)
    setDeductError(null)
    try {
      await apiFetch(`/school/credits/deductions/${movementId}/reverse/`, { method: 'POST' })
      await refreshAfterMovement()
      onChanged?.()
    } catch (err) {
      setDeductError(t(movementErrorKey(err)))
      await refreshAfterMovement()
    } finally {
      setDeductBusy(false)
    }
  }

  // A plain render function, not a nested component: a component declared
  // inside the modal would get a new identity on every render and remount
  // every card (dropping the progress-bar transition and any focus).
  function renderCard(p: PackageCard, onOpen?: () => void) {
    const total = Number(p.credits_total)
    const remaining = Number(p.credits_remaining)
    const used = total - remaining
    const pct = total > 0 ? Math.round((used / total) * 100) : 0
    const lessons = p.lessons_total != null && p.lessons_remaining != null
      ? { all: p.lessons_total, left: p.lessons_remaining, cost: Number(p.lesson_credit_cost ?? 0) }
      : null
    // Credits in small print ONLY when some credits do not make a whole
    // lesson: a leftover on the remaining, or a total that is no multiple
    // (manual credits added to a package).
    const leftover = lessons !== null
      && (Math.abs(lessons.left * lessons.cost - remaining) > EPS || Math.abs(lessons.all * lessons.cost - total) > EPS)
    return (
      <div key={p.id} className="p-3 bg-gray-50 rounded-xl">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-gray-800">{pkgName(p)}</p>
          <span className={`${PILL} ${p.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>
            {pkgStatus(p.status)}
          </span>
        </div>
        <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full bg-[#6B1F3A] rounded-full" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-gray-500 mt-1.5">
          {lessons
            ? <>{t('detailLessonsUsed', { used: lessons.all - lessons.left, total: lessons.all })} · {t('detailLessonsRemaining', { count: lessons.left })}</>
            : <>{t('detailCreditsUsed', { used, total })} · {t('detailRemaining', { count: remaining })}</>}
        </p>
        {leftover && (
          <p className="text-[11px] text-gray-400 mt-0.5">{t('detailCreditsLeftover', { remaining, total })}</p>
        )}
        <p className="text-xs text-gray-400 mt-0.5">
          {t('detailPurchased', { date: fmtD(p.purchased_at) })}
          {p.expires_at && ` · ${t('detailExpires', { date: fmtD(p.expires_at) })}`}
        </p>
        {onOpen && (
          <button onClick={onOpen} className="mt-2 text-xs text-[#6B1F3A] hover:underline">
            {t('detailViewUsage')}
          </button>
        )}
      </div>
    )
  }

  // Each ledger row is one lesson, so its credits are noise while the package
  // is told in lessons — unless this booking cost something other than what
  // one lesson costs today (the course price changed since): then the credits
  // stay, so the card above and the rows below can still be reconciled.
  const lessonCost = pkg?.package.lessons_remaining != null ? Number(pkg.package.lesson_credit_cost ?? 0) : null
  const showCredits = (b: PackageBooking) => lessonCost === null || Math.abs(Number(b.credits_deducted) - lessonCost) > EPS

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-6 pt-5 pb-4 border-b border-gray-100 sticky top-0 bg-white">
          {inPackage && studentId && (
            <button
              onClick={() => setOpenPackageId(null)}
              disabled={deductBusy}
              className="text-xs text-[#6B1F3A] hover:underline mb-1.5 disabled:opacity-40"
            >
              {t('detailBack')}
            </button>
          )}
          <h3 className="font-semibold text-gray-900 text-base">{t(inPackage ? 'detailPackageTitle' : 'detailActiveTitle')}</h3>
          <p className="text-sm text-gray-400 mt-0.5">
            {studentName}{pkg && ` · ${pkgName(pkg.package)}`}
          </p>
        </div>

        <div className="px-6 py-4 space-y-5">
          {failed ? (
            <p className="text-sm text-red-600">{t('detailLoadError')}</p>
          ) : loading ? (
            <div className="animate-pulse h-24 bg-gray-100 rounded-xl" />
          ) : pkg ? (
            <>
              {renderCard(pkg.package)}

              {canDeduct && (
                <div className="p-3 border border-gray-200 rounded-xl">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('detailDeductTitle')}</p>
                  <div className="flex gap-2">
                    <div className="w-28 shrink-0">
                      <label className="block text-[11px] text-gray-400 mb-1">{t(inLessons ? 'detailDeductLessons' : 'detailDeductCredits')}</label>
                      <input
                        type="number"
                        inputMode={inLessons ? 'numeric' : 'decimal'}
                        min={inLessons ? 1 : 0.5}
                        step={inLessons ? 1 : 0.5}
                        max={maxQty}
                        value={deductQty}
                        onChange={e => { setDeductQty(e.target.value); setDeductError(null) }}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <label className="block text-[11px] text-gray-400 mb-1">{t('detailDeductNote')}</label>
                      <input
                        type="text"
                        value={deductNote}
                        maxLength={200}
                        onChange={e => setDeductNote(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 mt-2">
                    <p className="text-[11px] text-gray-400">{deductError ? <span className="text-red-600">{deductError}</span> : t('detailDeductHint')}</p>
                    <button
                      onClick={submitDeduction}
                      disabled={deductBusy || !deductQty}
                      className="px-3 py-1.5 bg-[#6B1F3A] text-white rounded-lg text-xs font-medium hover:opacity-90 transition disabled:opacity-40 shrink-0"
                    >
                      {t('detailDeductSubmit')}
                    </button>
                  </div>
                </div>
              )}
              {/* An error from the undo, when the form above is not there to show it */}
              {!canDeduct && deductError && <p className="text-xs text-red-600">{deductError}</p>}

              {pkg.movements.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('detailMovements')}</p>
                  <div className="divide-y divide-gray-50">
                    {pkg.movements.map(m => (
                      <div key={m.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                        <div className="min-w-0">
                          <p className={m.reversed ? 'text-gray-400 line-through' : 'text-gray-800'}>
                            {m.kind === 'deduction' ? '−' : '+'}{movementQty(m)}
                            {' · '}{t(m.kind === 'deduction' ? 'detailDeductedBySchool' : 'detailDeductionReversed')}
                          </p>
                          <p className="text-xs text-gray-400 truncate">
                            {fmtD(m.at)}{m.by && ` · ${m.by}`}{m.note && ` · ${m.note}`}
                          </p>
                        </div>
                        {m.kind === 'deduction' && (m.reversed ? (
                          <span className={`${PILL} bg-gray-200 text-gray-500`}>{t('detailReversedPill')}</span>
                        ) : manualCreditsAllowed !== false && (
                          <button
                            onClick={() => reverseDeduction(m.id)}
                            disabled={deductBusy}
                            className="text-xs text-[#6B1F3A] hover:underline shrink-0 disabled:opacity-40"
                          >
                            {t('detailReverse')}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('detailPackageBookings')}</p>
                {pkg.bookings.length === 0 ? (
                  <p className="text-sm text-gray-300">{t('detailNoBookings')}</p>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {pkg.bookings.map(b => (
                      <div key={b.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                        <div className="min-w-0">
                          <p className="text-gray-800 truncate">{b.course_name || localizedName(b.lesson_type, uiLocale, '—')}</p>
                          <p className="text-xs text-gray-400">
                            {fmtLesson(b.lesson_date)}
                            {b.start_time && ` · ${b.start_time.slice(0, 5)}`}
                            {placeSuffix(b)}
                            {showCredits(b) && ` · ${t('creditsCount', { count: Number(b.credits_deducted) })}`}
                            {b.status === 'cancelled' && ` · ${t(b.credit_refunded ? 'detailRefunded' : 'detailBurned')}`}
                          </p>
                        </div>
                        <span className={`${PILL} ${bookingPill(b.status)}`}>{bookingStatus(b.status)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : student && (
            <>
              {student.packages.length === 0 ? (
                <p className="text-sm text-gray-300">{t('detailNoActivePackages')}</p>
              ) : (
                <div className="space-y-3">
                  {student.packages.map(p => renderCard(p, () => setOpenPackageId(p.id)))}
                </div>
              )}
              {/* Reports is a section of its own: a role without it would only be bounced to the dashboard */}
              {reportsAllowed !== false && (
                <Link
                  href={`/${uiLocale}/school/reports?tab=packages&student=${student.student.id}`}
                  className="inline-block text-xs text-[#6B1F3A] hover:underline"
                >
                  {t('detailHistoryLink')}
                </Link>
              )}
            </>
          )}
        </div>

        <div className="px-6 pb-5">
          <button onClick={onClose}
            className="w-full py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition">
            {t('detailClose')}
          </button>
        </div>
      </div>
    </div>
  )
}
