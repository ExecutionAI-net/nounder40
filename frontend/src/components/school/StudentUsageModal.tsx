'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { apiFetch } from '@/lib/api/client'
import { localizedName, type TranslatedNames } from '@/lib/localized-name'
import { placeLabel } from '@/lib/lesson-format'
import { useSchoolSectionAllowed } from '@/lib/school-permissions'

// Shared school-side modal for package usage, in two modes:
//  - student (Students → "Package usage"): ACTIVE packages only, each with
//    "Usage details →" that drills into the package ("←" comes back). Past
//    packages live in Reports → Packages filtered by student: link at the end.
//  - package (Reports → Bookings on the Source cell, Reports → Packages on
//    the row): one package with the bookings paid with it, i.e. its credit
//    ledger (a booking draws on exactly one package, a refund goes back to it).
// One view at a time, so the modal never grows with the years of purchases.
// Endpoints: /api/school/student-usage/ and /api/school/student-usage/packages/<id>/.

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

type StudentUsage = { student: { id: string; name: string }; packages: PackageCard[] }
type PackageUsage = { student: { id: string; name: string }; package: PackageCard; bookings: PackageBooking[] }

// Student mode needs the student; package mode needs the package and may
// carry the student to come back to (the drill-down from student mode).
type Target =
  | { studentId: string; studentPackageId?: undefined }
  | { studentPackageId: string; studentId?: string }

const PILL = 'text-xs px-2 py-0.5 rounded-full shrink-0'
const EPS = 1e-9 // credits are half-credit steps: exact in floating point, the epsilon is belt and braces

export default function StudentUsageModal(props: Target & { studentName: string; onClose: () => void }) {
  const { studentId, studentPackageId, studentName, onClose } = props
  const t = useTranslations('school.students')
  const uiLocale = useLocale()
  const reportsAllowed = useSchoolSectionAllowed('reports')
  // The open package: the caller's, or the one picked from the active list.
  // null = the active list (student mode only).
  const [openPackageId, setOpenPackageId] = useState<string | null>(studentPackageId ?? null)
  const [student, setStudent] = useState<StudentUsage | null>(null)
  const [studentFailed, setStudentFailed] = useState(false)
  const [pkg, setPkg] = useState<PackageUsage | null>(null)
  const [pkgFailed, setPkgFailed] = useState(false)

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
    setPkg(null)
    setPkgFailed(false)
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

  const inPackage = openPackageId !== null
  const failed = inPackage ? pkgFailed : studentFailed
  const loading = !failed && (inPackage ? !pkg : !student)

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
            <button onClick={() => setOpenPackageId(null)} className="text-xs text-[#6B1F3A] hover:underline mb-1.5">
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
