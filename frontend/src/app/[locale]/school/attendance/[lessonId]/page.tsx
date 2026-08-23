'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { apiFetch, ApiError } from '@/lib/api/client'

interface AttendanceStatus {
  id: string
  name: string
  color: string
  burns_credit: boolean
  is_default: boolean
  sort_order: number
}

interface BookingRow {
  booking_id: string
  student_id: string
  student_name: string
  access_source: string
  booking_status: string
  attendance_status: string | null
  attendance_status_id: string | null
}

interface LessonDetail {
  id: string
  date: string
  start_time: string
  status: string
  course_name: string | null
  room_name: string | null
}

export default function SchoolAttendancePage() {
  const t = useTranslations('school.attendance')
  const uiLocale = useLocale()
  const { lessonId } = useParams<{ lessonId: string }>()
  const router = useRouter()

  const [lesson, setLesson] = useState<LessonDetail | null>(null)
  const [statuses, setStatuses] = useState<AttendanceStatus[]>([])
  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [alreadySubmitted, setAlreadySubmitted] = useState(false)
  const [marks, setMarks] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // apiFetch, non fetch: serve il token JWT — senza, il backend risponde 401
    // e la pagina mostrava "lezione non trovata"
    apiFetch<{ lesson: LessonDetail; statuses?: AttendanceStatus[]; bookings?: BookingRow[]; already_submitted?: boolean }>(`/school/attendance/${lessonId}/`)
      .then(data => {
        setLesson(data.lesson)
        setStatuses(data.statuses ?? [])
        setBookings(data.bookings ?? [])
        setAlreadySubmitted(data.already_submitted ?? false)

        const allStatuses: AttendanceStatus[] = data.statuses ?? []
        const defaultStatus = allStatuses.find(s => s.is_default) ?? allStatuses[0]

        const initialMarks: Record<string, string> = {}
        for (const b of data.bookings ?? []) {
          if (b.attendance_status_id) {
            initialMarks[b.booking_id] = b.attendance_status_id
          } else if (defaultStatus) {
            initialMarks[b.booking_id] = defaultStatus.id
          }
        }
        setMarks(initialMarks)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [lessonId])

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)

    const defaultStatusId = statuses.find(s => s.is_default)?.id ?? statuses[0]?.id

    const attendance = bookings.map(b => ({
      booking_id: b.booking_id,
      student_id: b.student_id,
      status_id: marks[b.booking_id] ?? defaultStatusId,
    }))

    try {
      await apiFetch(`/school/attendance/${lessonId}/`, {
        method: 'POST',
        body: JSON.stringify({ attendance }),
      })
    } catch (err) {
      const body = err instanceof ApiError && typeof err.body === 'object' ? err.body as { error?: string } : null
      setError(body?.error ?? 'Failed to submit')
      setSubmitting(false)
      return
    }

    router.push('/school/calendar')
  }

  if (loading) {
    return <div className="animate-pulse h-8 bg-gray-100 rounded w-48" />
  }

  if (!lesson) {
    return <p className="text-gray-400 text-sm">{t('lessonNotFound')}</p>
  }

  const statusById = (id: string | null) => statuses.find(s => s.id === id)

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <button
          onClick={() => router.push('/school/calendar')}
          className="text-xs text-gray-400 hover:text-gray-600 mb-3 flex items-center gap-1 transition"
        >
          {t('backToCalendar')}
        </button>
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-gray-500 text-sm mt-1">
          {lesson.course_name} · {new Date(lesson.date).toLocaleDateString(uiLocale, { weekday: 'long', month: 'short', day: 'numeric' })} · {lesson.start_time?.slice(0, 5)}
          {lesson.room_name ? ` · ${lesson.room_name}` : ''}
        </p>
      </div>

      {alreadySubmitted && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-700">
          {t('alreadySubmitted')}
        </div>
      )}

      {statuses.length === 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
          {t('noStatuses')}
        </div>
      )}

      {bookings.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-6 text-sm text-gray-400">
          {t('noStudents')}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50 mb-6">
          {bookings.map(b => {
            const student = { name: b.student_name, email: '' }
            const selectedStatusId = marks[b.booking_id]
            const selectedStatus = statusById(selectedStatusId)

            return (
              <div key={b.booking_id} className="px-4 py-3.5">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{student?.name ?? '—'}</p>
                    <p className="text-xs text-gray-400">
                      {b.access_source === 'free_lesson'
                        ? t('freeLessonSource')
                        : b.access_source === 'subscription'
                        ? t('subscriptionSource')
                        : b.access_source === 'package'
                        ? t('packageSource')
                        : b.access_source}
                    </p>
                  </div>

                  {selectedStatus && (
                    <div className="flex flex-col items-end gap-0.5">
                      <span
                        className="text-xs px-2.5 py-1 rounded-full font-medium"
                        style={{ backgroundColor: selectedStatus.color + '20', color: selectedStatus.color }}
                      >
                        {selectedStatus.name}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        {selectedStatus.burns_credit ? t('burnsCredit') : t('noCreditDeduction')}
                      </span>
                    </div>
                  )}
                </div>

                {statuses.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {statuses.map(s => {
                      const isSelected = selectedStatusId === s.id
                      return (
                        <button
                          key={s.id}
                          onClick={() => setMarks(prev => ({ ...prev, [b.booking_id]: s.id }))}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition"
                          style={
                            isSelected
                              ? { backgroundColor: s.color, borderColor: s.color, color: '#ffffff' }
                              : { backgroundColor: 'transparent', borderColor: s.color + '60', color: s.color }
                          }
                        >
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: isSelected ? '#ffffff80' : s.color }}
                          />
                          {s.name}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      <div className="flex gap-3">
        {bookings.length > 0 && statuses.length > 0 && (
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 bg-gray-800 text-white rounded-xl py-3 text-sm font-medium hover:bg-gray-700 transition disabled:opacity-50"
          >
            {submitting
              ? t('saving')
              : alreadySubmitted
              ? t('updateAttendance')
              : t('submitAttendance')}
          </button>
        )}
        {/* Uscita senza salvare, sempre visibile */}
        <button
          onClick={() => router.push('/school/calendar')}
          className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-3 text-sm font-medium hover:bg-gray-50 transition"
        >
          {t('cancel')}
        </button>
      </div>
    </div>
  )
}
