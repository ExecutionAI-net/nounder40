'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import StudentPreviewModal from '@/components/school/StudentPreviewModal'
import ScheduleFields from '@/components/school/ScheduleFields'

type LessonType = { id: string; code: string; name_en: string; name_it: string; active: boolean }
type Teacher = { id: string; name: string }
type Room = { id: string; name: string; capacity: number; location_name: string }

type Schedule = {
  key: string          // unique key: "start_time|weekday" for grouping
  start_time: string
  duration_minutes: string
  weekday: string      // derived from existing lessons
  room_id: string
  teacher_id: string
  max_capacity: string
  credit_cost: string
  vip_booking_hours_before: string
  min_booking_notice_hours: string
  color: string
  reserve_spots: string
  waitlist_enabled: boolean
  original_weekday: string  // weekday when lessons were loaded — used for matching
  first_date: string       // prima lezione futura (sola lettura per orari esistenti)
  is_new?: boolean         // orario appena aggiunto: genera lezioni al salvataggio
  end_date: string         // ultima lezione — modificabile: accorcia o estende il periodo
}


const JS_DAY_TO_WEEKDAY = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']

export default function EditCoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const t = useTranslations('school.courses.edit')
  const router = useRouter()
  const supabase = createClient()

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
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPropagationDialog, setShowPropagationDialog] = useState(false)
  const [lessonSnapshot, setLessonSnapshot] = useState('')

  // firma dei campi che impattano le lezioni già generate
  function lessonSignature(scheds: Schedule[], teacher: string, online: boolean, link: string) {
    return JSON.stringify({ s: scheds.map(s => ({ t: s.start_time, d: s.duration_minutes, c: s.max_capacity, r: s.room_id, te: s.teacher_id, w: s.weekday })), teacher, online, link })
  }

  // HQ locations

  // Course-level fields
  const [lessonTypeId, setLessonTypeId] = useState('')
  const [courseName, setCourseName] = useState('')
  const [teacherId, setTeacherId] = useState('')
  const [description, setDescription] = useState('')
  const [notes, setNotes] = useState('')
  const [isOnline, setIsOnline] = useState(false)
  const [onlineLink, setOnlineLink] = useState('')
  const [courseCountry, setCourseCountry] = useState('')
  const [courseCity, setCourseCity] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [courseLanguage, setCourseLanguage] = useState('it')

  // Schedules (one per unique time+weekday combination)
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [openSchedule, setOpenSchedule] = useState<number>(0)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
      if (!profile?.school_id) return

      const today = new Date().toISOString().split('T')[0]

      const [courseRes, lt, loc, lessonsRes, thRes] = await Promise.all([
        fetch(`/api/school/courses/${id}`),
        supabase.from('lesson_types').select('*').order('name_it'),
        supabase.from('school_locations').select('id, name, school_rooms(id, name, capacity)').eq('school_id', profile.school_id),
        supabase.from('lessons')
          .select('start_time, end_time, date, teacher_id, room_id, max_capacity, status')
          .eq('course_id', id)
          .neq('status', 'cancelled')
          .gte('date', today)
          .order('date', { ascending: true })
          .limit(200),
        fetch('/api/school/teachers', { cache: 'no-store' }),
      ])

      if (!courseRes.ok) {
        setError(t('errorLoadCourse'))
        setLoading(false)
        return
      }
      const course = await courseRes.json()

      setLessonTypeId(course.lesson_type_id ?? '')
      setCourseName(course.name ?? '')
      setTeacherId(course.teacher_id ?? '')
      setDescription(course.description ?? '')
      setNotes(course.notes ?? '')
      setIsOnline(course.is_online ?? false)
      setOnlineLink(course.online_link ?? '')
      setCourseCountry(course.country ?? '')
      setCourseCity(course.city ?? '')
      setImageUrl(course.image_url ?? null)
      setCourseLanguage(course.language ?? 'it')

      setLessonTypes(lt.data ?? [])
      if (thRes.ok) {
        const thData = await thRes.json()
        type Teacher = { id: string; name: string }
        const teacherList: Teacher[] = (thData.teachers ?? [])
          .map((t: { teachers: Teacher | null }) => t.teachers)
          .filter((t: Teacher | null): t is Teacher => t !== null && !!t.id)
        setTeachers(teacherList)
      }

      const flatRooms: Room[] = []
      for (const location of loc.data ?? []) {
        for (const room of (location.school_rooms as { id: string; name: string; capacity: number }[] ?? [])) {
          flatRooms.push({ id: room.id, name: room.name, capacity: room.capacity, location_name: location.name })
        }
      }
      setRooms(flatRooms)

      // Build unique schedules from future lessons.
      // Collect unique (weekday + start_time) combos — each = one schedule.
      const allLessons = lessonsRes.data ?? []
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
          duration_minutes: String(dur > 0 ? dur : course.duration_minutes ?? 60),
          weekday,
          original_weekday: weekday,
          room_id: l.room_id ?? course.room_id ?? '',
          teacher_id: l.teacher_id ?? course.teacher_id ?? '',
          max_capacity: String(l.max_capacity ?? course.max_capacity ?? 15),
          credit_cost: String(course.credit_cost ?? 1),
          vip_booking_hours_before: String(course.vip_booking_hours_before ?? 0),
          min_booking_notice_hours: String(course.min_booking_notice_hours ?? 2),
          color: course.color ?? '#6B1F3A',
          reserve_spots: String(course.reserve_spots ?? 0),
          waitlist_enabled: course.waitlist_enabled ?? false,
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
          duration_minutes: String(course.duration_minutes ?? 60),
          weekday: '',
          original_weekday: '',
          room_id: course.room_id ?? '',
          teacher_id: course.teacher_id ?? '',
          max_capacity: String(course.max_capacity ?? 15),
          credit_cost: String(course.credit_cost ?? 1),
          vip_booking_hours_before: String(course.vip_booking_hours_before ?? 0),
          min_booking_notice_hours: String(course.min_booking_notice_hours ?? 2),
          color: course.color ?? '#6B1F3A',
          reserve_spots: String(course.reserve_spots ?? 0),
          waitlist_enabled: course.waitlist_enabled ?? false,
          first_date: course.start_date ?? '',
          end_date: course.end_date ?? '',
        })
      }

      setSchedules(derived)
      setLessonSnapshot(lessonSignature(derived, course.teacher_id ?? '', course.is_online ?? false, course.online_link ?? ''))
      setLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Aggiunge un nuovo orario inline: stessa scheda degli altri, date compilabili
  function addNewSchedule() {
    setSchedules(prev => {
      const last = prev[prev.length - 1]
      const next: Schedule = {
        key: `new-${prev.length}-${Math.random().toString(36).slice(2, 7)}`,
        start_time: last?.start_time ?? '',
        duration_minutes: last?.duration_minutes ?? '60',
        weekday: '',
        original_weekday: '',
        room_id: last?.room_id ?? '',
        teacher_id: last?.teacher_id ?? '',
        max_capacity: last?.max_capacity ?? '15',
        credit_cost: last?.credit_cost ?? '1',
        vip_booking_hours_before: last?.vip_booking_hours_before ?? '0',
        min_booking_notice_hours: last?.min_booking_notice_hours ?? '2',
        color: last?.color ?? '#2563eb',
        reserve_spots: last?.reserve_spots ?? '0',
        waitlist_enabled: last?.waitlist_enabled ?? false,
        first_date: '',
        end_date: '',
        is_new: true,
      }
      setOpenSchedule(prev.length)
      return [...prev, next]
    })
  }

  async function handleSubmit(updateFutureClasses: boolean) {
    setShowPropagationDialog(false)
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/school/courses/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lesson_type_id: lessonTypeId,
          name: courseName || null,
          teacher_id: teacherId || null,
          description: description || null,
          notes: notes || null,
          is_online: isOnline,
          online_link: onlineLink || null,
          country: courseCountry || null,
          city: courseCity || null,
          // Use first schedule as course-level defaults
          start_time: schedules[0]?.start_time,
          duration_minutes: schedules[0]?.duration_minutes,
          max_capacity: schedules[0]?.max_capacity,
          credit_cost: schedules[0]?.credit_cost,
          color: schedules[0]?.color,
          vip_booking_hours_before: schedules[0]?.vip_booking_hours_before,
          min_booking_notice_hours: schedules[0]?.min_booking_notice_hours,
          reserve_spots: schedules[0]?.reserve_spots,
          waitlist_enabled: schedules[0]?.waitlist_enabled,
          update_future_lessons: updateFutureClasses,
          // Pass all schedules for per-weekday bulk update
          schedules: schedules.map(s => ({
            start_time: s.start_time,
            duration_minutes: Number(s.duration_minutes),
            max_capacity: Number(s.max_capacity),
            credit_cost: Number(s.credit_cost),
            color: s.color,
            vip_booking_hours_before: Number(s.vip_booking_hours_before),
            min_booking_notice_hours: Number(s.min_booking_notice_hours),
            reserve_spots: Number(s.reserve_spots),
            waitlist_enabled: s.waitlist_enabled,
            room_id: s.room_id || null,
            teacher_id: s.teacher_id || null,
            weekday: s.weekday || null,
            original_weekday: s.original_weekday || null,
            end_date: s.end_date || null,
            start_date: s.first_date || null,
            is_new: s.is_new || false,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error === 'missing_fields'
          ? t('errorMissingFields', { fields: (data.fields ?? []).map((f: string) => t(`fieldName_${f}`)).join(', ') })
          : data.error ?? t('errorGeneric'))
        setSubmitting(false)
      } else {
        router.push(`/school/courses/${id}`)
      }
    } catch (err) {
      console.error('[edit course] submit error:', err)
      setError(t('errorGeneric'))
      setSubmitting(false)
    }
  }

  const inputCls = 'w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20'
  const labelCls = 'block text-sm font-medium text-gray-700 mb-1'

  if (loading) {
    return (
      <div className="max-w-2xl">
        <div className="mb-6">
          <Link href={`/school/courses/${id}`} className="text-sm text-gray-400 hover:text-gray-600">{t('backToCourse')}</Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-2">{t('title')}</h1>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-gray-400 text-sm">{t('loading')}</div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="mb-6">
        <Link href={`/school/courses/${id}`} className="text-sm text-gray-400 hover:text-gray-600">{t('backToCourse')}</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">{t('title')}</h1>
      </div>

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
              <option key={lt.id} value={lt.id}>{(lt.name_it || lt.name_en) + (lt.active ? '' : ` — ${t('inactiveSuffix')}`)}</option>
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
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>{t('labelCountry')}</label>
            <input value={courseCountry} onChange={(e) => setCourseCountry(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>{t('labelCity')}</label>
            <input value={courseCity} onChange={(e) => setCourseCity(e.target.value)} className={inputCls} />
          </div>
        </div>
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

        <div>
          <label className={labelCls}>{t('labelOnline')}</label>
          <button
            type="button"
            onClick={() => { setIsOnline(!isOnline); if (isOnline) setOnlineLink('') }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition border ${isOnline ? 'bg-[#6B1F3A] text-white border-[#6B1F3A]' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
          >
            {isOnline ? '🌐 Online' : '📍 In-Person'}
          </button>
          {isOnline && (
            <input
              type="url"
              value={onlineLink}
              onChange={(e) => setOnlineLink(e.target.value)}
              placeholder="https://zoom.us/j/..."
              className={`${inputCls} mt-2`}
            />
          )}
        </div>
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
                  showDates
                  showWeekday
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex justify-between">
        <Link href={`/school/courses/${id}`}
          className="px-5 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition">
          {t('cancel')}
        </Link>
        <button
          type="button"
          onClick={() => {
            const changed = lessonSignature(schedules, teacherId, isOnline, onlineLink) !== lessonSnapshot
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
          creditCost={schedules[0]?.credit_cost ?? '1'}
          language={courseLanguage || null}
          startTime={schedules[0]?.start_time ?? null}
          durationMinutes={schedules[0]?.duration_minutes ?? null}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  )
}
