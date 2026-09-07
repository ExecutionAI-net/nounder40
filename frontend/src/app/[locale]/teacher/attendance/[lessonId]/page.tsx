'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { apiFetch, ApiError } from '@/lib/api/client'
import { attendanceStatusKey } from '@/lib/attendance-status-label'
import { LessonFullDialog, OverCapacityBadge } from '@/components/school/LessonCapacity'
import { lessonFullInfo, type LessonFullInfo } from '@/lib/lesson-closure'

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
  current_bookings: number
  max_capacity: number
}

// Cosa può fare qui oltre all'appello (teachers/access.py): la lezione è sua
// o di una collega, e se la scuola le ha concesso di aggiungere/togliere allieve
interface Permissions {
  is_own: boolean
  teacher_name: string
  can_manage_bookings: boolean
}

interface AttendanceResponse {
  lesson: LessonDetail
  statuses: AttendanceStatus[]
  bookings: BookingRow[]
  already_submitted: boolean
  permissions?: Permissions
}

interface StudentHit {
  id: string
  name: string
  booked: boolean
}

type RosterErrorKey = 'errNoValidAccess' | 'errAlreadyBooked' | 'errLessonCancelled' | 'errGeneric'

function rosterErrorKey(code: string | undefined): RosterErrorKey {
  if (code === 'no_valid_access') return 'errNoValidAccess'
  if (code === 'already_booked') return 'errAlreadyBooked'
  if (code === 'lesson_cancelled') return 'errLessonCancelled'
  return 'errGeneric'
}

export default function AttendanceLessonPage() {
  const t = useTranslations('teacher.attendance.detail')
  const tStatus = useTranslations('attendanceStatusNames')
  const statusLabel = (name: string) => { const k = attendanceStatusKey(name); return k ? tStatus(k as Parameters<typeof tStatus>[0]) : name }
  const uiLocale = useLocale()
  const { lessonId } = useParams<{ lessonId: string }>()
  const router = useRouter()

  const [lesson, setLesson] = useState<LessonDetail | null>(null)
  const [statuses, setStatuses] = useState<AttendanceStatus[]>([])
  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [alreadySubmitted, setAlreadySubmitted] = useState(false)
  const [permissions, setPermissions] = useState<Permissions | null>(null)
  // marks: bookingId → statusId
  const [marks, setMarks] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Staff: aggiungi / togli allieve
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<StudentHit[]>([])
  const [searching, setSearching] = useState(false)
  const [busyStudent, setBusyStudent] = useState<string | null>(null)
  const [armedRemove, setArmedRemove] = useState<string | null>(null)
  const [rosterError, setRosterError] = useState<string | null>(null)
  // R2-M12: conferma prima di sforare + indicatore di sforamento sul registro
  const [lessonFull, setLessonFull] = useState<{ studentId: string; info: LessonFullInfo } | null>(null)
  const [overCapacity, setOverCapacity] = useState<LessonFullInfo | null>(null)

  const load = useCallback(async () => {
    const data = await apiFetch<AttendanceResponse>(`/teacher/attendance/${lessonId}/`)
    setLesson(data.lesson)
    setStatuses(data.statuses ?? [])
    setBookings(data.bookings ?? [])
    setAlreadySubmitted(data.already_submitted ?? false)
    setPermissions(data.permissions ?? null)

    // R2-M12: lo sforamento si ricava dal registro stesso, così l'indicatore
    // sopravvive a un ricaricamento invece di vivere solo nella risposta
    // della POST di iscrizione.
    const { current_bookings: current, max_capacity: max } = data.lesson
    setOverCapacity(max > 0 && current > max ? { current, max } : null)

    const allStatuses: AttendanceStatus[] = data.statuses ?? []
    const defaultStatus = allStatuses.find(s => s.is_default) ?? allStatuses[0]

    // Le scelte già fatte restano (un'allieva aggiunta al volo non deve
    // azzerare l'appello in corso); le righe nuove partono da quanto salvato
    // o dallo stato di default
    setMarks(prev => {
      const next: Record<string, string> = {}
      for (const b of data.bookings ?? []) {
        const v = prev[b.booking_id] ?? b.attendance_status_id ?? defaultStatus?.id
        if (v) next[b.booking_id] = v
      }
      return next
    })
  }, [lessonId])

  useEffect(() => {
    load().catch(() => {}).finally(() => setLoading(false))
  }, [load])

  // Ricerca allieve della scuola (solo con il permesso), con un piccolo ritardo
  const canManage = permissions?.can_manage_bookings ?? false
  useEffect(() => {
    if (!canManage) return
    const q = query.trim()
    if (!q) { setHits([]); return }
    const handle = setTimeout(async () => {
      setSearching(true)
      try {
        setHits(await apiFetch<StudentHit[]>(`/teacher/attendance/${lessonId}/students/?q=${encodeURIComponent(q)}`))
      } catch {
        setHits([])
      }
      setSearching(false)
    }, 300)
    return () => clearTimeout(handle)
  }, [query, lessonId, canManage])

  // Il secondo tocco su "Togli" vale solo per pochi secondi
  useEffect(() => {
    if (!armedRemove) return
    const handle = setTimeout(() => setArmedRemove(null), 4000)
    return () => clearTimeout(handle)
  }, [armedRemove])

  // `allowOverbooking` = stessa POST rifatta dopo la conferma esplicita
  async function addStudent(studentId: string, allowOverbooking = false) {
    setBusyStudent(studentId)
    setRosterError(null)
    try {
      await apiFetch(`/teacher/attendance/${lessonId}/students/`, {
        method: 'POST',
        body: JSON.stringify(
          allowOverbooking ? { student_id: studentId, allow_overbooking: true } : { student_id: studentId }
        ),
      })
      // Lo sforamento lo rilegge `load()` dal registro, che è la fonte
      // autorevole anche dopo un ricaricamento.
      setLessonFull(null)
      setQuery('')
      setHits([])
      await load()
    } catch (err) {
      const full = lessonFullInfo(err)
      if (full) {
        // Sotto capienza non compare nessuna conferma.
        setLessonFull({ studentId, info: full })
        setBusyStudent(null)
        return
      }
      const body = err instanceof ApiError ? err.body as { error?: string } : null
      setRosterError(t(rosterErrorKey(body?.error)))
    }
    setBusyStudent(null)
  }

  async function removeStudent(studentId: string) {
    if (armedRemove !== studentId) { setArmedRemove(studentId); return }
    setArmedRemove(null)
    setBusyStudent(studentId)
    setRosterError(null)
    try {
      await apiFetch(`/teacher/attendance/${lessonId}/students/?student_id=${studentId}`, { method: 'DELETE' })
      await load()
    } catch (err) {
      const body = err instanceof ApiError ? err.body as { error?: string } : null
      setRosterError(t(rosterErrorKey(body?.error)))
    }
    setBusyStudent(null)
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)

    const defaultStatusId = statuses.find(s => s.is_default)?.id ?? statuses[0]?.id

    const attendance = bookings.map(b => {
      const statusId = marks[b.booking_id] ?? defaultStatusId
      return {
        student_id: b.student_id,
        status_id: statusId,
      }
    })

    try {
      await apiFetch(`/teacher/attendance/${lessonId}/`, { method: 'POST', body: JSON.stringify(attendance) })
      router.push('/teacher/attendance')
    } catch (err) {
      const body = err instanceof ApiError ? err.body as { error?: string } : null
      // R2-M10: uno status_id sconosciuto (elenco stati cambiato mentre il
      // registro era aperto) fa rifiutare TUTTO — niente è stato scritto.
      setError(body?.error === 'invalid_status_id'
        ? tStatus('errorInvalidStatusId')
        : body?.error ?? tStatus('errorSubmit'))
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="animate-pulse h-8 bg-gray-100 rounded w-48" />
  }

  if (!lesson) {
    return <p className="text-gray-400 text-sm">Lesson not found.</p>
  }

  // Find status object by id for display
  const statusById = (id: string | null) => statuses.find(s => s.id === id)

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-gray-500 text-sm mt-1">
          {lesson.course_name} · {new Date(lesson.date).toLocaleDateString(uiLocale, { weekday: 'long', month: 'short', day: 'numeric' })} · {lesson.start_time?.slice(0, 5)}
          {lesson.room_name ? ` · ${lesson.room_name}` : ''}
        </p>
        {overCapacity && (
          <p className="mt-2">
            <OverCapacityBadge current={overCapacity.current} max={overCapacity.max} />
          </p>
        )}
        {permissions && !permissions.is_own && permissions.teacher_name && (
          <p className="mt-2 inline-block text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
            👤 {t('colleagueLesson', { name: permissions.teacher_name })}
          </p>
        )}
      </div>

      {alreadySubmitted && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-700">
          {t('successMessage')}
        </div>
      )}

      {statuses.length === 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
          No attendance statuses configured. Ask your school admin to set them up in Settings → Attendance Statuses.
        </div>
      )}

      {bookings.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-6 text-sm text-gray-400 mb-6">
          {t('subtitle')}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50 mb-6">
          {bookings.map(b => {
            const selectedStatusId = marks[b.booking_id]
            const selectedStatus = statusById(selectedStatusId)
            // Si toglie solo chi non è ancora stata segnata: un'assenza o una
            // presenza registrata è storia, non un posto da liberare
            const removable = canManage && b.booking_status === 'confirmed'

            return (
              <div key={b.booking_id} className="px-4 py-3.5">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{b.student_name ?? '—'}</p>
                    <p className="text-xs text-gray-400">
                      {b.access_source === 'free_lesson'
                        ? tStatus('accessFreeLesson')
                        : b.access_source === 'subscription'
                        ? tStatus('accessSubscription')
                        : b.access_source === 'package'
                        ? tStatus('accessPackage')
                        : b.access_source}
                    </p>
                  </div>

                  <div className="flex flex-col items-end gap-1">
                    {selectedStatus && (
                      <span
                        className="text-xs px-2.5 py-1 rounded-full font-medium"
                        style={{
                          backgroundColor: (selectedStatus.color || '#6b7280') + '20',
                          color: selectedStatus.color || '#6b7280',
                        }}
                      >
                        {statusLabel(selectedStatus.name)}
                      </span>
                    )}
                    {removable && (
                      <button
                        type="button"
                        onClick={() => removeStudent(b.student_id)}
                        disabled={busyStudent === b.student_id}
                        title={t('removeHint')}
                        className={`text-xs px-2 py-0.5 rounded-lg border transition disabled:opacity-50 ${
                          armedRemove === b.student_id
                            ? 'border-red-300 bg-red-50 text-red-600 font-medium'
                            : 'border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-200'
                        }`}
                      >
                        {armedRemove === b.student_id ? t('removeArmed') : t('remove')}
                      </button>
                    )}
                  </div>
                </div>

                {statuses.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {statuses.map(s => {
                      const isSelected = selectedStatusId === s.id
                      const statusColor = s.color || '#6b7280'
                      return (
                        <button
                          key={s.id}
                          onClick={() => setMarks(prev => ({ ...prev, [b.booking_id]: s.id }))}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition"
                          style={
                            isSelected
                              ? {
                                  backgroundColor: statusColor,
                                  borderColor: statusColor,
                                  color: '#ffffff',
                                }
                              : {
                                  backgroundColor: 'transparent',
                                  borderColor: statusColor + '60',
                                  color: statusColor,
                                }
                          }
                        >
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: isSelected ? '#ffffff80' : statusColor }}
                          />
                          {statusLabel(s.name)}
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

      {/* Staff (TeacherSchool.can_manage_bookings): iscrive un'allieva della
          scuola a questa lezione, con lo stesso motore del pannello scuola */}
      {canManage && (
        <div className="bg-white rounded-xl border border-gray-100 p-4 mb-6">
          <p className="text-sm font-medium text-gray-900 mb-2">{t('addStudentTitle')}</p>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-800/10"
          />
          {query.trim() && (
            <div className="mt-2 divide-y divide-gray-50">
              {hits.length === 0 ? (
                <p className="text-xs text-gray-400 py-2">{searching ? '…' : t('noResults')}</p>
              ) : (
                hits.map(h => (
                  <div key={h.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-sm text-gray-800 truncate">{h.name}</span>
                    {h.booked ? (
                      <span className="text-xs text-gray-400 shrink-0">{t('alreadyIn')}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => addStudent(h.id)}
                        disabled={busyStudent === h.id}
                        className="shrink-0 text-xs px-3 py-1.5 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition disabled:opacity-50"
                      >
                        {t('add')}
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
          {rosterError && <p className="text-xs text-red-600 mt-2">{rosterError}</p>}
        </div>
      )}

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      {bookings.length > 0 && statuses.length > 0 && (
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full bg-gray-800 text-white rounded-xl py-3 text-sm font-medium hover:bg-gray-700 transition disabled:opacity-50"
        >
          {submitting
            ? t('saving')
            : alreadySubmitted
            ? t('buttonSave')
            : t('buttonSave')}
        </button>
      )}

      {lessonFull && (
        <LessonFullDialog
          info={lessonFull.info}
          busy={busyStudent === lessonFull.studentId}
          onConfirm={() => addStudent(lessonFull.studentId, true)}
          onCancel={() => setLessonFull(null)}
        />
      )}
    </div>
  )
}
