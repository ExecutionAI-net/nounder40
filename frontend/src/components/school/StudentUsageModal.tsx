'use client'

import { useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { apiFetch } from '@/lib/api/client'

// Modale condiviso lato scuola: uso pacchetti/abbonamenti e ultime prenotazioni
// di una studentessa. Usato da Allieve e da Report → Pacchetti e abbonamenti.
// Si carica da solo via /api/school/students/detail (chiavi in school.students).

type LocName = { name_en?: string | null; name_it?: string | null; name_es?: string | null } | null

export type StudentUsageData = {
  packages: { id: string; credits_total: number; credits_remaining: number; purchased_at: string; expires_at: string | null; status: string; payment_method: string | null; packages: LocName }[]
  subscriptions: { id: string; access_total: number | null; access_remaining: number | null; started_at: string; current_period_end: string | null; status: string; subscriptions_catalog: LocName }[]
  bookings: { id: string; status: string; credits_deducted: number; access_source: string | null; booked_at: string; lessons: { date: string; start_time: string | null; courses: { name: string | null } | null; lesson_types: LocName } | null }[]
}

export default function StudentUsageModal({
  studentId,
  studentName,
  onClose,
}: {
  studentId: string
  studentName: string
  onClose: () => void
}) {
  const t = useTranslations('school.students')
  const uiLocale = useLocale()
  const [data, setData] = useState<StudentUsageData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setData(null)
    apiFetch<StudentUsageData>(`/school/students/detail/?student_id=${studentId}`)
      .then(d => { if (alive) { setData(d); setLoading(false) } })
      .catch(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [studentId])

  function locName(obj: LocName): string {
    if (!obj) return '—'
    const by: Record<string, string | null | undefined> = { it: obj.name_it, en: obj.name_en, es: obj.name_es }
    return by[uiLocale] || obj.name_en || obj.name_it || '—'
  }

  const fmtD = (d: string) => new Date(d).toLocaleDateString(uiLocale, { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-6 pt-5 pb-4 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="font-semibold text-gray-900 text-base">{t('detailTitle')}</h3>
          <p className="text-sm text-gray-400 mt-0.5">{studentName}</p>
        </div>
        <div className="px-6 py-4 space-y-5">
          {loading ? (
            <div className="animate-pulse h-24 bg-gray-100 rounded-xl" />
          ) : data && (
            <>
              {/* Pacchetti: barra crediti usati */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('detailPackages')}</p>
                {data.packages.length === 0 ? (
                  <p className="text-sm text-gray-300">{t('detailNoPackages')}</p>
                ) : data.packages.map(pk => {
                  const used = pk.credits_total - pk.credits_remaining
                  const pct = pk.credits_total > 0 ? Math.round(used / pk.credits_total * 100) : 0
                  return (
                    <div key={pk.id} className="mb-3 p-3 bg-gray-50 rounded-xl">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-gray-800">{locName(pk.packages)}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${pk.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>
                          {t(pk.status === 'active' ? 'statusActive' : pk.status === 'expired' ? 'statusExpired' : 'statusExhausted')}
                        </span>
                      </div>
                      <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-full bg-[#6B1F3A] rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-xs text-gray-500 mt-1.5">
                        {t('detailCreditsUsed', { used, total: pk.credits_total })} · {t('detailRemaining', { count: pk.credits_remaining })}
                        {pk.expires_at && ` · ${t('detailExpires', { date: fmtD(pk.expires_at) })}`}
                      </p>
                    </div>
                  )
                })}
              </div>

              {/* Abbonamenti */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('detailSubscriptions')}</p>
                {data.subscriptions.length === 0 ? (
                  <p className="text-sm text-gray-300">{t('detailNoSubs')}</p>
                ) : data.subscriptions.map(sub => (
                  <div key={sub.id} className="mb-3 p-3 bg-gray-50 rounded-xl">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-gray-800">{locName(sub.subscriptions_catalog)}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${sub.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>
                        {t(sub.status === 'active' ? 'statusActive' : sub.status === 'suspended' ? 'statusSuspended' : 'statusCancelled')}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1.5">
                      {sub.access_total === null ? t('detailUnlimited') : t('detailAccesses', { remaining: sub.access_remaining ?? 0, total: sub.access_total })}
                      {sub.current_period_end && ` · ${t('detailExpires', { date: fmtD(sub.current_period_end) })}`}
                    </p>
                  </div>
                ))}
              </div>

              {/* Ultime prenotazioni */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('detailBookings')}</p>
                {data.bookings.length === 0 ? (
                  <p className="text-sm text-gray-300">{t('detailNoBookings')}</p>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {data.bookings.map(b => (
                      <div key={b.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                        <div className="min-w-0">
                          <p className="text-gray-800 truncate">{b.lessons?.courses?.name?.trim() || locName(b.lessons?.lesson_types ?? null)}</p>
                          <p className="text-xs text-gray-400">
                            {b.lessons?.date && new Date(b.lessons.date + 'T12:00:00').toLocaleDateString(uiLocale, { weekday: 'short', day: 'numeric', month: 'short' })}
                            {b.lessons?.start_time && ` · ${b.lessons.start_time.slice(0, 5)}`}
                            {b.credits_deducted > 0 && ` · ${b.credits_deducted} cr`}
                          </p>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
                          b.status === 'attended' ? 'bg-green-100 text-green-700'
                            : b.status === 'no_show' ? 'bg-red-100 text-red-600'
                            : b.status === 'cancelled' ? 'bg-gray-200 text-gray-500'
                            : 'bg-blue-50 text-blue-600'}`}>
                          {t(b.status === 'attended' ? 'bookingAttended' : b.status === 'no_show' ? 'bookingNoShow' : b.status === 'cancelled' ? 'bookingCancelled' : 'bookingConfirmed')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
