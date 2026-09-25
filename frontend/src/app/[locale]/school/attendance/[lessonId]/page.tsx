'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { apiFetch, ApiError } from '@/lib/api/client'
import LessonNotesBox from '@/components/lessons/LessonNotesBox'
import { LessonFullDialog } from '@/components/school/LessonCapacity'
import { lessonFullInfo, type LessonFullInfo } from '@/lib/lesson-closure'
import { attendanceStatusKey } from '@/lib/attendance-status-label'
import { useArmedAction } from '@/lib/useArmedAction'

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
  notes?: string
  internal_notes?: string
  course_internal_notes?: string
}

type StudentOption = { id: string; name: string }

// L'endpoint scuola risponde con frasi, non codici (course_views
// SchoolClassStudentsView._ENROL_ERRORS): si riconoscono qui e si traducono
type RosterErrorKey = 'errNoValidAccess' | 'errAlreadyBooked' | 'errLessonCancelled' | 'errGeneric'
function rosterErrorKey(err: unknown): RosterErrorKey {
  const body = err instanceof ApiError && typeof err.body === 'object' && err.body ? (err.body as { error?: string }) : null
  const msg = (body?.error ?? '').toLowerCase()
  if (msg.includes('cancelled')) return 'errLessonCancelled'
  if (msg.includes('already')) return 'errAlreadyBooked'
  if (msg.includes('credits') || msg.includes('no_valid_access')) return 'errNoValidAccess'
  return 'errGeneric'
}

export default function SchoolAttendancePage() {
  const t = useTranslations('school.attendance')
  const tStatus = useTranslations('attendanceStatusNames')
  const statusLabel = (name: string) => { const k = attendanceStatusKey(name); return k ? tStatus(k as Parameters<typeof tStatus>[0]) : name }
  const uiLocale = useLocale()
  const { lessonId } = useParams<{ lessonId: string }>()
  const router = useRouter()
  // Da dove si e' arrivate (Lezioni, Corsi → vedi lezioni, Calendario):
  // "Indietro" e "Annulla" tornano li', non sempre al calendario
  const searchParams = useSearchParams()
  const from = searchParams.get('from') ?? ''
  const backHref = from === 'lessons' ? '/school/lessons' : from.startsWith('course:') ? `/school/courses/${from.slice(7)}` : '/school/calendar'
  const backLabel = from === 'lessons' ? t('backToLessons') : from.startsWith('course:') ? t('backToCourse') : t('backToCalendar')

  const [lesson, setLesson] = useState<LessonDetail | null>(null)
  const [statuses, setStatuses] = useState<AttendanceStatus[]>([])
  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [alreadySubmitted, setAlreadySubmitted] = useState(false)
  const [marks, setMarks] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Aggiungi / togli allieve da qui, come nel registro dell'insegnante:
  // stesso motore (staff_enrol / staff_unenrol), stessa conferma sullo sforamento
  const [schoolStudents, setSchoolStudents] = useState<StudentOption[]>([])
  const [query, setQuery] = useState('')
  const [busyStudent, setBusyStudent] = useState<string | null>(null)
  const [armedRemove, setArmedRemove] = useState<string | null>(null)
  const [rosterError, setRosterError] = useState<string | null>(null)
  const [lessonFull, setLessonFull] = useState<{ studentId: string; info: LessonFullInfo } | null>(null)

  // apiFetch, non fetch: serve il token JWT — senza, il backend risponde 401
  // e la pagina mostrava "lezione non trovata". Rilanciata dopo ogni
  // iscrizione/rimozione: le segnature già scelte a schermo restano.
  const load = useCallback(async () => {
    const data = await apiFetch<{ lesson: LessonDetail; statuses?: AttendanceStatus[]; bookings?: BookingRow[]; already_submitted?: boolean }>(`/school/attendance/${lessonId}/`)
    setLesson(data.lesson)
    setStatuses(data.statuses ?? [])
    setBookings(data.bookings ?? [])
    setAlreadySubmitted(data.already_submitted ?? false)

    const allStatuses: AttendanceStatus[] = data.statuses ?? []
    const defaultStatus = allStatuses.find(s => s.is_default) ?? allStatuses[0]

    setMarks(prev => {
      const next: Record<string, string> = {}
      for (const b of data.bookings ?? []) {
        const mark = prev[b.booking_id] ?? b.attendance_status_id ?? defaultStatus?.id
        if (mark) next[b.booking_id] = mark
      }
      return next
    })
  }, [lessonId])

  useEffect(() => {
    load().catch(() => {}).finally(() => setLoading(false))
    apiFetch<{ students: { id: string; name: string } }[]>('/school/students/')
      .then(rows => setSchoolStudents(rows.map(r => r.students).filter(Boolean)))
      .catch(() => setSchoolStudents([]))
  }, [load])

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
      await apiFetch(`/school/classes/${lessonId}/students/`, {
        method: 'POST',
        body: JSON.stringify(allowOverbooking ? { student_id: studentId, allow_overbooking: true } : { student_id: studentId }),
      })
      setLessonFull(null)
      setQuery('')
      await load()
    } catch (err) {
      const full = lessonFullInfo(err)
      if (full) {
        setLessonFull({ studentId, info: full })
        setBusyStudent(null)
        return
      }
      setRosterError(t(rosterErrorKey(err)))
    }
    setBusyStudent(null)
  }

  async function removeStudent(studentId: string) {
    if (armedRemove !== studentId) { setArmedRemove(studentId); return }
    setArmedRemove(null)
    setBusyStudent(studentId)
    setRosterError(null)
    try {
      await apiFetch(`/school/classes/${lessonId}/students/?student_id=${studentId}`, { method: 'DELETE' })
      await load()
    } catch (err) {
      setRosterError(t(rosterErrorKey(err)))
    }
    setBusyStudent(null)
  }

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
      // R2-M10: elenco stati non piu' valido — il backend non ha scritto nulla
      setError(body?.error === 'invalid_status_id'
        ? tStatus('errorInvalidStatusId')
        // Niente codice grezzo a schermo: la lezione e' iniziata mentre il
        // registro era aperto — stesso testo dell'avviso qui sotto.
        : body?.error === 'lesson_not_yet_occurred'
        ? t('notYetOccurred')
        : body?.error ?? tStatus('errorSubmit'))
      setSubmitting(false)
      return
    }

    router.push(backHref)
  }

  // Doppia conferma (deciso con Carlo, 25/9/2026): una volta inviato il
  // registro le prenotazioni passano a presente/assente e "Togli" con il
  // credito indietro non e' piu' possibile. Primo clic arma il bottone,
  // secondo clic chiede conferma — stesso pattern di "Annulla lezione".
  const submit = useArmedAction(handleSubmit, { confirm: () => t('submitConfirm', { count: bookings.length }) })

  if (loading) {
    return <div className="animate-pulse h-8 bg-gray-100 rounded w-48" />
  }

  if (!lesson) {
    return <p className="text-gray-400 text-sm">{t('lessonNotFound')}</p>
  }

  const statusById = (id: string | null) => statuses.find(s => s.id === id)
  const lessonCancelled = lesson.status === 'cancelled'
  // Come nel registro dell'insegnante: prima dell'orario di inizio il backend
  // rifiuta le presenze (QA #10), quindi avviso al posto del bottone.
  const lessonNotYetOccurred = new Date(`${lesson.date}T${lesson.start_time}`) > new Date()
  const bookedIds = new Set(bookings.map(b => b.student_id))
  const q = query.trim().toLowerCase()
  const hits = q ? schoolStudents.filter(s => s.name.toLowerCase().includes(q)).slice(0, 20) : []

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <button
          onClick={() => router.push(backHref)}
          className="text-xs text-gray-400 hover:text-gray-600 mb-3 flex items-center gap-1 transition"
        >
          {backLabel}
        </button>
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-gray-500 text-sm mt-1">
          {lesson.course_name} · {new Date(lesson.date).toLocaleDateString(uiLocale, { weekday: 'long', month: 'short', day: 'numeric' })} · {lesson.start_time?.slice(0, 5)}
          {lesson.room_name ? ` · ${lesson.room_name}` : ''}
        </p>
      </div>

      {/* Stesso box dell'insegnante: la nota interna si scrive anche da qui */}
      <LessonNotesBox
        publicNotes={lesson.notes ?? ''}
        courseInternalNotes={lesson.course_internal_notes ?? ''}
        value={lesson.internal_notes ?? ''}
        onSave={async (internal_notes) => {
          await apiFetch(`/school/classes/${lessonId}/`, { method: 'PATCH', body: JSON.stringify({ internal_notes }) })
          setLesson(l => (l ? { ...l, internal_notes } : l))
        }}
      />

      {lessonNotYetOccurred && !lessonCancelled && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
          {t('notYetOccurred')}
        </div>
      )}

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
        <div className="bg-white rounded-xl border border-gray-100 p-6 text-sm text-gray-400 mb-6">
          {t('noStudents')}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50 mb-6">
          {bookings.map(b => {
                        const selectedStatusId = marks[b.booking_id]
            const selectedStatus = statusById(selectedStatusId)

            return (
              <div key={b.booking_id} className="px-4 py-3.5">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{b.student_name ?? '—'}</p>
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

                  <div className="flex flex-col items-end gap-1">
                    {selectedStatus && (
                      <span
                        className="text-xs px-2.5 py-1 rounded-full font-medium"
                        style={{ backgroundColor: selectedStatus.color + '20', color: selectedStatus.color }}
                      >
                        {statusLabel(selectedStatus.name)}
                      </span>
                    )}
                    {/* Si toglie solo chi non è ancora stata segnata: una
                        presenza registrata è storia, non un posto da liberare */}
                    {b.booking_status === 'confirmed' && !lessonCancelled && (
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

      {/* Stessa sezione del registro insegnante: iscrive un'allieva della scuola a questa lezione */}
      {!lessonCancelled && (
        <div className="bg-white rounded-xl border border-gray-100 p-4 mb-6">
          <p className="text-sm font-medium text-gray-900 mb-2">{t('addStudentTitle')}</p>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-800/10"
          />
          {q && (
            <div className="mt-2 divide-y divide-gray-50">
              {hits.length === 0 ? (
                <p className="text-xs text-gray-400 py-2">{t('noResults')}</p>
              ) : (
                hits.map(h => (
                  <div key={h.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-sm text-gray-800 truncate">{h.name}</span>
                    {bookedIds.has(h.id) ? (
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

      <div className="flex gap-3">
        {bookings.length > 0 && statuses.length > 0 && !lessonNotYetOccurred && (
          <button
            onClick={submit.trigger}
            disabled={submitting}
            className={`flex-1 text-white rounded-xl py-3 text-sm font-medium transition disabled:opacity-50 ${
              submit.armed ? 'bg-amber-600 hover:bg-amber-700' : 'bg-gray-800 hover:bg-gray-700'
            }`}
          >
            {submitting
              ? t('saving')
              : submit.armed
              ? t('submitArmed')
              : alreadySubmitted
              ? t('updateAttendance')
              : t('submitAttendance')}
          </button>
        )}
        {/* Uscita senza salvare, sempre visibile */}
        <button
          onClick={() => router.push(backHref)}
          className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-3 text-sm font-medium hover:bg-gray-50 transition"
        >
          {t('cancel')}
        </button>
      </div>

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
