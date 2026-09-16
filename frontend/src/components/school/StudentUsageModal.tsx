'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { apiFetch } from '@/lib/api/client'
import { localizedName, type TranslatedNames } from '@/lib/localized-name'

// Modale condiviso lato scuola per l'uso dei pacchetti, in due modalità:
//  - allieva (Allieve → "Uso Pacchetti"): solo i pacchetti ATTIVI, ognuno con
//    "Dettaglio uso →" che entra nel pacchetto (e "←" per tornare). I passati
//    stanno in Report → Pacchetti filtrato per allieva: link in fondo.
//  - pacchetto (Report → Prenotazioni sulla Fonte, Report → Pacchetti sulla
//    riga): un solo pacchetto con le prenotazioni pagate con quello, cioè il
//    suo registro crediti (una prenotazione attinge a un solo pacchetto e il
//    rimborso torna sullo stesso).
// Una vista per volta: cosi' la scheda non cresce con gli anni di acquisti.
// Endpoint: /api/school/students/usage/ e /api/school/students/packages/<id>/usage/.

type PackageCard = {
  id: string
  name: TranslatedNames
  credits_total: number | string
  credits_remaining: number | string
  purchased_at: string
  expires_at: string | null
  status: string
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
}

type StudentUsage = { student: { id: string; name: string }; packages: PackageCard[] }
type PackageUsage = { student: { id: string; name: string }; package: PackageCard; bookings: PackageBooking[] }

const PILL = 'text-xs px-2 py-0.5 rounded-full shrink-0'

export default function StudentUsageModal({
  studentId,
  studentPackageId,
  studentName,
  onClose,
}: {
  /** Modalità allieva: i suoi pacchetti attivi, con drill-down. */
  studentId?: string
  /** Modalità pacchetto: quel pacchetto e le sue prenotazioni. Se passato, si apre direttamente lì. */
  studentPackageId?: string
  studentName: string
  onClose: () => void
}) {
  const t = useTranslations('school.students')
  const uiLocale = useLocale()
  // Il pacchetto aperto: quello del chiamante, o quello scelto dalla lista
  // degli attivi. null = lista degli attivi (solo con studentId).
  const [openPackageId, setOpenPackageId] = useState<string | null>(studentPackageId ?? null)
  const [student, setStudent] = useState<StudentUsage | null>(null)
  const [pkg, setPkg] = useState<PackageUsage | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!studentId) return
    let alive = true
    setFailed(false)
    apiFetch<StudentUsage>(`/school/students/usage/?student_id=${studentId}`)
      .then(d => { if (alive) setStudent(d) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [studentId])

  useEffect(() => {
    if (!openPackageId) return
    let alive = true
    setPkg(null)
    setFailed(false)
    apiFetch<PackageUsage>(`/school/students/packages/${openPackageId}/usage/`)
      .then(d => { if (alive) setPkg(d) })
      .catch(() => { if (alive) setFailed(true) })
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

  const inPackage = openPackageId !== null
  const loadedPkg = inPackage && pkg?.package.id === openPackageId ? pkg : null
  const loading = !failed && (inPackage ? !loadedPkg : !student)

  function Card({ p, onOpen }: { p: PackageCard; onOpen?: () => void }) {
    const total = Number(p.credits_total)
    const remaining = Number(p.credits_remaining)
    const used = total - remaining
    const pct = total > 0 ? Math.round((used / total) * 100) : 0
    return (
      <div className="p-3 bg-gray-50 rounded-xl">
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
          {t('detailCreditsUsed', { used, total })} · {t('detailRemaining', { count: remaining })}
        </p>
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
            {studentName}{loadedPkg && ` · ${pkgName(loadedPkg.package)}`}
          </p>
        </div>

        <div className="px-6 py-4 space-y-5">
          {failed ? (
            <p className="text-sm text-red-600">{t('detailLoadError')}</p>
          ) : loading ? (
            <div className="animate-pulse h-24 bg-gray-100 rounded-xl" />
          ) : loadedPkg ? (
            <>
              <Card p={loadedPkg.package} />
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('detailPackageBookings')}</p>
                {loadedPkg.bookings.length === 0 ? (
                  <p className="text-sm text-gray-300">{t('detailNoBookings')}</p>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {loadedPkg.bookings.map(b => (
                      <div key={b.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                        <div className="min-w-0">
                          <p className="text-gray-800 truncate">{b.course_name || localizedName(b.lesson_type, uiLocale, '—')}</p>
                          <p className="text-xs text-gray-400">
                            {fmtLesson(b.lesson_date)}
                            {b.start_time && ` · ${b.start_time.slice(0, 5)}`}
                            {` · ${t('creditsCount', { count: Number(b.credits_deducted) })}`}
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
                  {student.packages.map(p => (
                    <Card key={p.id} p={p} onOpen={() => setOpenPackageId(p.id)} />
                  ))}
                </div>
              )}
              <Link
                href={`/${uiLocale}/school/reports?tab=packages&student=${student.student.id}`}
                className="inline-block text-xs text-[#6B1F3A] hover:underline"
              >
                {t('detailHistoryLink')}
              </Link>
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
