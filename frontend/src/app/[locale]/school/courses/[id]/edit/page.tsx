'use client'

import { useEffect, useState, use } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import StudentPreviewModal from '@/components/school/StudentPreviewModal'
import ScheduleFields from '@/components/school/ScheduleFields'
import { lessonTypeName } from '@/lib/lesson-type-name'
import { apiFetch, ApiError } from '@/lib/api/client'
import { useArmedAction } from '@/lib/useArmedAction'
import { COURSE_LANGUAGES } from '@/lib/languages'

type LessonType = { id: string; code: string; name_en: string; name_it: string; active: boolean; sort_order?: number | null }
type Teacher = { id: string; name: string }
type Room = { id: string; name: string; capacity: number; location_name: string }
type Plan = { id: string; name: string }

type Schedule = {
  key: string          // unique key: "start_time|weekday" for grouping
  start_time: string
  duration_minutes: string
  weekday: string      // derived from existing lessons
  room_id: string
  teacher_id: string
  max_capacity: string
  color: string
  compensation_plan_id: string   // '' = come il corso
  waitlist_enabled: boolean
  is_online: boolean
  online_link: string
  original_weekday: string  // weekday when lessons were loaded — used for matching
  original_start_time: string // ora al caricamento — matching preciso con più orari nello stesso giorno
  first_date: string       // prima lezione futura (sola lettura per orari esistenti)
  is_new?: boolean         // orario appena aggiunto: genera lezioni al salvataggio
  end_date: string         // ultima lezione — modificabile: accorcia o estende il periodo
  language: string         // '' = same as course
}


const JS_DAY_TO_WEEKDAY = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']

export default function EditCoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const searchParams = useSearchParams()
  // Salva/Annulla tornano da dove sei arrivato: lista Corsi (default) o dettaglio
  const backHref = searchParams.get('from') === 'detail' ? `/school/courses/${id}` : '/school/courses'
  const t = useTranslations('school.courses.edit')
  const tSched = useTranslations('scheduleFields')
  const uiLocale = useLocale()
  const router = useRouter()

  const WEEKDAYS = [
    { value: 'monday', label: t('monday') },
    { value: 'tuesday', label: t('tuesday') },
    { value: 'wednesday', label: t('wednesday') },
    { value: 'thursday', label: t('thursday') },
    { value: 'friday', label: t('friday') },
    { value: 'saturday', label: t('saturday') },
    { value: 'sunday', label: t('sunday') },
  ]

  function scheduleLabel(s: Schedule): string {
    const weekday = WEEKDAYS.find(w => w.value === s.weekday)?.label ?? s.weekday
    const dayPart = weekday ? ` · ${weekday}` : ''
    return `${s.start_time}${dayPart} · ${s.duration_minutes}min`
  }

  const [lessonTypes, setLessonTypes] = useState<LessonType[]>([])
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPropagationDialog, setShowPropagationDialog] = useState(false)
  const [lessonSnapshot, setLessonSnapshot] = useState('')

  // firma dei campi che impattano le lezioni già generate
  function lessonSignature(scheds: Schedule[], teacher: string) {
    return JSON.stringify({ s: scheds.map(s => ({ t: s.start_time, d: s.duration_minutes, c: s.max_capacity, r: s.room_id, te: s.teacher_id, w: s.weekday })), teacher })
  }

  // HQ locations

  // Course-level fields
  const [lessonTypeId, setLessonTypeId] = useState('')
  const [courseName, setCourseName] = useState('')
  const [teacherId, setTeacherId] = useState('')
  const [description, setDescription] = useState('')
  const [notes, setNotes] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [courseLanguage, setCourseLanguage] = useState('it')
  const [creditCost, setCreditCost] = useState('1')
  const [compensationPlanId, setCompensationPlanId] = useState('')
  const [vipHours, setVipHours] = useState('0')
  const [minNotice, setMinNotice] = useState('2')
  const [reserveSpots, setReserveSpots] = useState('0')
  const [schoolLang, setSchoolLang] = useState<string | null>(null)

  // Schedules (one per unique time+weekday combination)
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [openSchedule, setOpenSchedule] = useState<number>(0)

  useEffect(() => {
    async function load() {
      const today = new Date().toISOString().split('T')[0]

      type LessonFlat = { start_time: string | null; end_time: string | null; date: string; status: string; teacher: string | null; room: string | null; max_capacity: number | null; color: string | null; compensation_plan_id: string | null; is_online: boolean | null; online_link: string | null; language: string | null }
      type LessonRow = { start_time: string | null; end_time: string | null; date: string; teacher_id: string | null; room_id: string | null; max_capacity: number | null; color: string | null; compensation_plan_id: string | null; is_online: boolean | null; online_link: string | null; language: string | null }
      type LocationRow = { id: string; name: string; rooms: { id: string; name: string; capacity: number }[] }
      type TeachersResponse = { teachers: { teachers: { id: string; name: string } | null }[] }
      type CourseFull = {
        lesson_type_id: string | null; name: string | null; teacher_id: string | null; room_id: string | null
        description: string | null; notes: string | null; image_url: string | null; language: string | null
        start_time: string | null; start_date: string | null; end_date: string | null
        duration_minutes: number | null; max_capacity: number | null; credit_cost: number | null
        vip_booking_hours_before: number | null; min_booking_notice_hours: number | null
        color: string | null; reserve_spots: number | null; waitlist_enabled: boolean | null
        compensation_plan_id: string | null
        is_online: boolean | null; online_link: string | null
      }

      const [course, lt, loc, lessonsRaw, pl, thData, school] = await Promise.all([
        apiFetch<CourseFull>(`/school/courses/${id}/full/`).catch(() => null),
        apiFetch<LessonType[]>('/school/lesson-types/'),
        apiFetch<LocationRow[]>('/school/locations/'),
        apiFetch<LessonFlat[]>(`/school/lessons/?course=${id}`),
        apiFetch<Plan[]>('/school/compensation-plans/'),
        apiFetch<TeachersResponse>('/school/teachers/'),
        apiFetch<{ language?: string }>('/school/profile/').catch((): { language?: string } => ({})),
      ])
      if (school.language) setSchoolLang(school.language)

      if (!course) {
        setError(t('errorLoadCourse'))
        setLoading(false)
        return
      }

      // Le lezioni vanno lette TUTTE (nessuna paginazione lato Django): il
      // vecchio limit(200) troncava le date di fine dei corsi lunghi e al
      // salvataggio cancellava le lezioni oltre.
      const allLessons: LessonRow[] = lessonsRaw
        .filter(l => l.status !== 'cancelled' && l.date >= today)
        .map(l => ({ ...l, teacher_id: l.teacher, room_id: l.room }))
        .sort((a, b) => a.date.localeCompare(b.date))

      setLessonTypeId(course.lesson_type_id ?? '')
      setCourseName(course.name ?? '')
      setTeacherId(course.teacher_id ?? '')
      setDescription(course.description ?? '')
      setNotes(course.notes ?? '')
      setImageUrl(course.image_url ?? null)
      setCourseLanguage(course.language ?? 'it')
      setCreditCost(String(course.credit_cost ?? 1))
      setCompensationPlanId(course.compensation_plan_id ?? '')
      setVipHours(String(course.vip_booking_hours_before ?? 0))
      setMinNotice(String(course.min_booking_notice_hours ?? 2))
      setReserveSpots(String(course.reserve_spots ?? 0))

      setLessonTypes(lt.sort((a, b) => ((a.sort_order ?? 1e9) - (b.sort_order ?? 1e9)) || (a.name_en ?? '').localeCompare(b.name_en ?? '')))
      const teacherList: Teacher[] = (thData.teachers ?? [])
        .map(t => t.teachers)
        .filter((t): t is Teacher => t !== null && !!t.id)
      setTeachers(teacherList)

      const flatRooms: Room[] = []
      for (const location of loc ?? []) {
        for (const room of location.rooms ?? []) {
          flatRooms.push({ id: room.id, name: room.name, capacity: room.capacity, location_name: location.name })
        }
      }
      setRooms(flatRooms)
      setPlans(pl ?? [])

      // Build unique schedules from future lessons.
      // Collect unique (weekday + start_time) combos — each = one schedule.
      const seen = new Map<string, Schedule>()
      const derived: Schedule[] = []

      for (const l of allLessons) {
        const jsDay = new Date(l.date + 'T12:00:00').getDay()
        const weekday = JS_DAY_TO_WEEKDAY[jsDay]
        const key = `${weekday}|${l.start_time?.slice(0, 5)}`
        const existing = seen.get(key)
        if (existing) {
          // aggiorna il periodo (prima/ultima lezione futura)
          if (l.date < existing.first_date) existing.first_date = l.date
          if (l.date > existing.end_date) existing.end_date = l.date
          continue
        }

        // Duration from start/end
        const [sh, sm] = (l.start_time ?? '').split(':').map(Number)
        const [eh, em] = (l.end_time ?? '').split(':').map(Number)
        const dur = (eh * 60 + em) - (sh * 60 + sm)

        const schedEntry: Schedule = {
          key,
          start_time: l.start_time?.slice(0, 5) ?? '',
          original_start_time: l.start_time?.slice(0, 5) ?? '',
          duration_minutes: String(dur > 0 ? dur : course.duration_minutes ?? 60),
          weekday,
          original_weekday: weekday,
          room_id: l.room_id ?? course.room_id ?? '',
          teacher_id: l.teacher_id ?? course.teacher_id ?? '',
          max_capacity: String(l.max_capacity ?? course.max_capacity ?? 15),
          color: l.color ?? course.color ?? '#6B1F3A',
          compensation_plan_id: l.compensation_plan_id ?? '',
          waitlist_enabled: course.waitlist_enabled ?? false,
          is_online: l.is_online ?? course.is_online ?? false,
          online_link: l.online_link ?? course.online_link ?? '',
          language: l.language ?? '',
          first_date: l.date,
          end_date: l.date,
        }
        derived.push(schedEntry)
        seen.set(key, schedEntry)
      }

      // Fallback: if no future lessons, build one from course data
      if (derived.length === 0) {
        derived.push({
          key: 'default',
          start_time: course.start_time?.slice(0, 5) ?? '',
          original_start_time: course.start_time?.slice(0, 5) ?? '',
          duration_minutes: String(course.duration_minutes ?? 60),
          weekday: '',
          original_weekday: '',
          room_id: course.room_id ?? '',
          teacher_id: course.teacher_id ?? '',
          max_capacity: String(course.max_capacity ?? 15),
          color: course.color ?? '#6B1F3A',
          compensation_plan_id: '',
          waitlist_enabled: course.waitlist_enabled ?? false,
          is_online: course.is_online ?? false,
          online_link: course.online_link ?? '',
          language: '',
          first_date: course.start_date ?? '',
          end_date: course.end_date ?? '',
        })
      }

      console.info(`[edit course] ${allLessons.length} lezioni caricate → ${derived.length} orari derivati`)
      setSchedules(derived)
      setLessonSnapshot(lessonSignature(derived, course.teacher_id ?? ''))
      setLoading(false)
    }
    // Se il caricamento fallisce NON mostrare il form: salvare con orari
    // derivati male/parziali riscriverebbe le lezioni esistenti.
    load().catch(err => {
      console.error('[edit course] load error:', err)
      setLoadFailed(true)
      setLoading(false)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Aggiunge un nuovo orario inline: stessa scheda degli altri, date compilabili
  function addNewSchedule() {
    setSchedules(prev => {
      const last = prev[prev.length - 1]
      const next: Schedule = {
        key: `new-${prev.length}-${Math.random().toString(36).slice(2, 7)}`,
        start_time: last?.start_time ?? '',
        original_start_time: '',
        duration_minutes: last?.duration_minutes ?? '60',
        weekday: '',
        original_weekday: '',
        room_id: last?.room_id ?? '',
        teacher_id: last?.teacher_id ?? '',
        max_capacity: last?.max_capacity ?? '15',
        color: last?.color ?? '#2563eb',
        compensation_plan_id: last?.compensation_plan_id ?? '',
        waitlist_enabled: last?.waitlist_enabled ?? false,
        is_online: last?.is_online ?? false,
        online_link: last?.online_link ?? '',
        language: last?.language ?? '',
        // copia anche il periodo dall'ultimo orario (modificabile)
        first_date: last?.first_date ?? '',
        end_date: last?.end_date ?? '',
        is_new: true,
      }
      setOpenSchedule(prev.length)
      return [...prev, next]
    })
  }

  // Restringere le date annulla lezioni gia' prenotate: il server si ferma
  // (409) e si va avanti solo dopo la doppia conferma, con rimborso a tutte
  const [cancelWarning, setCancelWarning] = useState<{ lessons: number; bookings: number; updateFuture: boolean } | null>(null)
  const { armed: cancelArmed, busy: cancelBusy, trigger: confirmCancel } = useArmedAction(async () => {
    if (!cancelWarning) return
    const { updateFuture } = cancelWarning
    setCancelWarning(null)
    await handleSubmit(updateFuture, true)
  })

  async function handleSubmit(updateFutureClasses: boolean, confirmCancelBookings = false) {
    setShowPropagationDialog(false)
    // Data fine prima della data inizio = nessuna lezione generabile: blocca subito
    for (const [i, s] of schedules.entries()) {
      if (s.first_date && s.end_date && s.end_date < s.first_date) {
        setError(t('errorEndBeforeStart', { num: i + 1 }))
        setOpenSchedule(i)
        return
      }
    }
    setSubmitting(true)
    setError(null)
    try {
      await apiFetch(`/school/courses/${id}/full/`, {
        method: 'PUT',
        body: JSON.stringify({
          lesson_type_id: lessonTypeId,
          name: courseName || null,
          teacher_id: teacherId || null,
          description: description || null,
          notes: notes || null,
          // online/in presenza è per orario: il corso eredita dal primo
          is_online: schedules[0]?.is_online ?? false,
          online_link: schedules[0]?.online_link || null,
          language: courseLanguage,
          // Use first schedule as course-level defaults
          start_time: schedules[0]?.start_time,
          duration_minutes: schedules[0]?.duration_minutes,
          max_capacity: schedules[0]?.max_capacity,
          color: schedules[0]?.color,
          credit_cost: Number(creditCost),
          compensation_plan_id: compensationPlanId || null,
          vip_booking_hours_before: Number(vipHours),
          min_booking_notice_hours: Number(minNotice),
          reserve_spots: Number(reserveSpots),
          waitlist_enabled: schedules[0]?.waitlist_enabled,
          update_future_lessons: updateFutureClasses,
          confirm_cancel_bookings: confirmCancelBookings,
          // Pass all schedules for per-weekday bulk update
          schedules: schedules.map(s => ({
            start_time: s.start_time,
            duration_minutes: Number(s.duration_minutes),
            max_capacity: Number(s.max_capacity),
            color: s.color,
            waitlist_enabled: s.waitlist_enabled,
            room_id: s.room_id || null,
            teacher_id: s.teacher_id || null,
            compensation_plan_id: s.compensation_plan_id || null,
            is_online: s.is_online,
            online_link: s.online_link || null,
            language: s.language || '',
            weekday: s.weekday || null,
            original_weekday: s.original_weekday || null,
            original_start_time: s.original_start_time || null,
            end_date: s.end_date || null,
            start_date: s.first_date || null,
            is_new: s.is_new || false,
          })),
        }),
      })
      // dopo il salvataggio si torna da dove si è arrivati
      router.push(backHref)
    } catch (err) {
      console.error('[edit course] submit error:', err)
      const body = err instanceof ApiError ? err.body as { error?: string; fields?: string[]; lessons?: number; bookings?: number } : null
      if (body?.error === 'bookings_would_be_cancelled') {
        setCancelWarning({ lessons: body.lessons ?? 0, bookings: body.bookings ?? 0, updateFuture: updateFutureClasses })
        setSubmitting(false)
        return
      }
      setError(body?.error === 'missing_fields'
        ? t('errorMissingFields', { fields: (body.fields ?? []).map((f: string) => t(`fieldName_${f}`)).join(', ') })
        : body?.error ?? t('errorGeneric'))
      setSubmitting(false)
    }
  }

  const inputCls = 'w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20'
  const labelCls = 'block text-sm font-medium text-gray-700 mb-1'

  if (loadFailed) {
    return (
      <div className="max-w-2xl">
        <div className="mb-6">
          <Link href="/school/courses" className="text-sm text-gray-400 hover:text-gray-600">{t('backToCourse')}</Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-2">{t('title')}</h1>
        </div>
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
          {t('errorLoadCourse')}
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="max-w-2xl">
        <div className="mb-6">
          <Link href="/school/courses" className="text-sm text-gray-400 hover:text-gray-600">{t('backToCourse')}</Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-2">{t('title')}</h1>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-gray-400 text-sm">{t('loading')}</div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="mb-6">
        <Link href="/school/courses" className="text-sm text-gray-400 hover:text-gray-600">{t('backToCourse')}</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">{t('title')}</h1>
      </div>

      {cancelWarning && (

        <div className="p-4 rounded-xl border border-red-200 bg-red-50 space-y-3">

          <p className="text-sm font-semibold text-red-700">{t('wouldCancelTitle', { lessons: cancelWarning.lessons, bookings: cancelWarning.bookings })}</p>

          <p className="text-sm text-red-700">{t('wouldCancelDesc')}</p>

          <div className="flex gap-2">

            <button type="button" onClick={confirmCancel} disabled={cancelBusy}

              className={`px-4 py-2 rounded-lg text-sm font-medium transition disabled:opacity-50 ${cancelArmed ? 'bg-red-600 text-white hover:bg-red-700' : 'border border-red-300 text-red-700 hover:bg-red-100'}`}>

              {cancelBusy ? t('wouldCancelWorking') : cancelArmed ? t('wouldCancelArmed') : t('wouldCancelConfirm')}

            </button>

            <button type="button" onClick={() => setCancelWarning(null)} className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">

              {t('wouldCancelBack')}

            </button>

          </div>

        </div>

      )}

      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}

      {/* Course-level fields */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-5">
        <h2 className="text-sm font-semibold text-gray-700">{t('courseDetails')}</h2>
        <div>
          <label className={labelCls}>{t('labelLessonType')}</label>
          <select
            value={lessonTypeId}
            onChange={(e) => setLessonTypeId(e.target.value)}
            className={inputCls}
          >
            <option value="">{t('selectLessonType')}</option>
            {lessonTypes.map((lt) => (
              <option key={lt.id} value={lt.id}>{(lessonTypeName(lt, schoolLang ?? uiLocale) || lt.name_en) + (lt.active ? '' : ` — ${t('inactiveSuffix')}`)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>{t('labelDefaultTeacher')}</label>
          <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} className={inputCls}>
            <option value="">{t('noTeacher')}</option>
            {teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}
          </select>
        </div>
        {/* Course instruction language — schedules/lessons can override it */}
        <div>
          <label className={labelCls}>{t('labelLanguage')}</label>
          <select value={courseLanguage} onChange={(e) => setCourseLanguage(e.target.value)} className={inputCls}>
            {COURSE_LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
          <p className="text-xs text-gray-400 mt-1">{t('languageHint')}</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>{tSched('labelCreditCost')}</label>
            <input type="number" min="0.5" step="0.5" value={creditCost} onChange={e => setCreditCost(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>{tSched('labelCompPlan')}</label>
            <select value={compensationPlanId} onChange={e => setCompensationPlanId(e.target.value)} className={inputCls}>
              <option value="">{tSched('noPlan')}</option>
              {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>{tSched('labelVipBooking')}</label>
            <input type="number" min="0" value={vipHours} onChange={e => setVipHours(e.target.value)} className={inputCls} />
            <p className="text-xs text-gray-400 mt-1">{tSched('vipBookingHint')}</p>
          </div>
          <div>
            <label className={labelCls}>{tSched('labelMinNotice')}</label>
            <input type="number" min="0" value={minNotice} onChange={e => setMinNotice(e.target.value)} className={inputCls} />
            <p className="text-xs text-gray-400 mt-1">{tSched('minNoticeHint')}</p>
          </div>
          <div>
            <label className={labelCls}>{tSched('labelReserveSpots')}</label>
            <input type="number" min="0" value={reserveSpots} onChange={e => setReserveSpots(e.target.value)} className={inputCls} />
            <p className="text-xs text-gray-400 mt-1">{tSched('reserveSpotsHint')}</p>
          </div>
        </div>
        {/* Paese/Città rimossi dalla UI: derivano dalla scuola (le sedi governano la posizione) */}
        <div>
          <label className={labelCls}>{t('labelDescription')}</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputCls} placeholder={t('descriptionPlaceholder')} />
        </div>
        <div>
          <label className={labelCls}>{t('labelNotes')}</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={`${inputCls} resize-none`} placeholder={t('notesPlaceholder')} />
        </div>
        <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
          <p className="text-xs text-gray-500">{t('previewHint')}</p>
          <button type="button" onClick={() => setShowPreview(true)}
            className="text-sm px-4 py-2 border border-[#6B1F3A]/30 text-[#6B1F3A] rounded-lg font-medium hover:bg-[#6B1F3A]/5 transition whitespace-nowrap">
            👁 {t('previewButton')}
          </button>
        </div>

        {/* Online/in presenza spostato a livello di singolo orario */}
      </div>

      {/* Schedules */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">{t('schedules')}</h2>
        <p className="text-xs text-gray-400">{t('schedulesHint')}</p>

        <button
          type="button"
          onClick={addNewSchedule}
          className="inline-flex items-center gap-1 text-sm text-[#6B1F3A] font-medium hover:underline"
        >
          + {t('addScheduleInline')}
        </button>

        {schedules.map((sched, idx) => (
          <div key={sched.key} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            {/* Header */}
            <div
              className="flex items-center justify-between px-5 py-3.5 cursor-pointer hover:bg-gray-50 transition"
              onClick={() => setOpenSchedule(openSchedule === idx ? -1 : idx)}
            >
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: sched.color }} />
                <div>
                  <p className="text-sm font-medium text-gray-900">{t('scheduleNumber', { num: idx + 1 })}</p>
                  <p className="text-xs text-gray-400">{scheduleLabel(sched)}</p>
                </div>
              </div>
              <span className="text-gray-300 text-sm">{openSchedule === idx ? '▲' : '▼'}</span>
            </div>

            {/* Form */}
            {openSchedule === idx && (
              <div className="px-5 pb-5 pt-1 border-t border-gray-50">
                <ScheduleFields
                  mode="schedule"
                  value={sched}
                  onChange={(patch) => setSchedules(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s))}
                  rooms={rooms}
                  teachers={teachers}
                  plans={plans}
                  showDates
                  showWeekday
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex justify-between">
        <Link href={backHref}
          className="px-5 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition">
          {t('cancel')}
        </Link>
        <button
          type="button"
          onClick={() => {
            const changed = lessonSignature(schedules, teacherId) !== lessonSnapshot
            const hasNew = schedules.some(s => s.is_new)
            if (!changed || hasNew && schedules.every(s => s.is_new)) {
              handleSubmit(false) // niente da propagare: salva e basta
            } else {
              setShowPropagationDialog(true)
            }
          }}
          disabled={submitting}
          className="px-6 py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
        >
          {submitting ? t('saving') : t('saveChanges')}
        </button>
      </div>

      {/* Propagation dialog */}
      {showPropagationDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <h3 className="font-semibold text-gray-900 text-base">{t('propagationTitle')}</h3>
            <p className="text-sm text-gray-500">
              {t('propagationDesc')}
            </p>
            <div className="flex flex-col gap-2 pt-1">
              <button onClick={() => handleSubmit(true)}
                className="w-full px-4 py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition">
                {t('updateAll')}
              </button>
              <button onClick={() => handleSubmit(false)}
                className="w-full px-4 py-2.5 border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition">
                {t('updateTemplateOnly')}
              </button>
              <button onClick={() => setShowPropagationDialog(false)}
                className="w-full px-4 py-2.5 text-gray-400 rounded-lg text-sm hover:bg-gray-50 transition">
                {t('cancelDialog')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPreview && (
        <StudentPreviewModal
          lessonType={lessonTypes.find(lt => lt.id === lessonTypeId) ?? null}
          courseName={courseName || null}
          courseImage={imageUrl}
          teacherName={teachers.find(x => x.id === teacherId)?.name ?? null}
          creditCost={creditCost}
          language={courseLanguage || null}
          startTime={schedules[0]?.start_time ?? null}
          durationMinutes={schedules[0]?.duration_minutes ?? null}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  )
}
