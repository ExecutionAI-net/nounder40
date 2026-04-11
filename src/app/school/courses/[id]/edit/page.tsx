'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

type LessonType = { id: string; code: string; name_en: string; name_it: string }
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
}

const COLORS = ['#6B1F3A', '#1F3A6B', '#1F6B3A', '#6B5A1F', '#3A1F6B', '#1F6B5A', '#6B1F1F', '#4A4A4A']

const WEEKDAYS = [
  { value: 'monday', label: 'Monday' },
  { value: 'tuesday', label: 'Tuesday' },
  { value: 'wednesday', label: 'Wednesday' },
  { value: 'thursday', label: 'Thursday' },
  { value: 'friday', label: 'Friday' },
  { value: 'saturday', label: 'Saturday' },
  { value: 'sunday', label: 'Sunday' },
]

const JS_DAY_TO_WEEKDAY = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']

function scheduleLabel(s: Schedule): string {
  const weekday = WEEKDAYS.find(w => w.value === s.weekday)?.label ?? s.weekday
  const dayPart = weekday ? ` · ${weekday}` : ''
  return `${s.start_time}${dayPart} · ${s.duration_minutes}min`
}

export default function EditCoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const supabase = createClient()

  const [lessonTypes, setLessonTypes] = useState<LessonType[]>([])
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPropagationDialog, setShowPropagationDialog] = useState(false)

  // Course-level fields
  const [lessonTypeId, setLessonTypeId] = useState('')
  const [courseName, setCourseName] = useState('')
  const [teacherId, setTeacherId] = useState('')
  const [description, setDescription] = useState('')

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

      const [courseRes, lt, th, loc, lessonsRes] = await Promise.all([
        fetch(`/api/school/courses/${id}`),
        supabase.from('lesson_types').select('id, code, name_en, name_it').eq('active', true).order('name_en'),
        supabase.from('teachers').select('id, name').eq('school_id', profile.school_id).eq('active', true).order('name'),
        supabase.from('school_locations').select('id, name, school_rooms(id, name, capacity)').eq('school_id', profile.school_id),
        supabase.from('lessons')
          .select('start_time, end_time, date, teacher_id, room_id, max_capacity, status')
          .eq('course_id', id)
          .neq('status', 'cancelled')
          .gte('date', today)
          .order('date', { ascending: true })
          .limit(200),
      ])

      if (!courseRes.ok) {
        setError('Course not found')
        setLoading(false)
        return
      }
      const course = await courseRes.json()

      setLessonTypeId(course.lesson_type_id ?? '')
      setCourseName(course.name ?? '')
      setTeacherId(course.teacher_id ?? '')
      setDescription(course.description ?? '')

      setLessonTypes(lt.data ?? [])
      setTeachers(th.data ?? [])

      const flatRooms: Room[] = []
      for (const location of loc.data ?? []) {
        for (const room of (location.school_rooms as { id: string; name: string; capacity: number }[] ?? [])) {
          flatRooms.push({ id: room.id, name: room.name, capacity: room.capacity, location_name: location.name })
        }
      }
      setRooms(flatRooms)

      // Build unique schedules from future lessons.
      // Look at lessons within the first 14 days — this covers weekly (7 days)
      // and bi-weekly (14 days) patterns. Each unique lesson in this window = one schedule.
      const allLessons = lessonsRes.data ?? []
      const firstDate = allLessons[0]?.date
      const windowLessons = firstDate
        ? allLessons.filter(l => {
            const diff = (new Date(l.date + 'T12:00:00').getTime() - new Date(firstDate + 'T12:00:00').getTime()) / (1000 * 60 * 60 * 24)
            return diff < 14
          })
        : allLessons.slice(0, 4)

      const derived: Schedule[] = []

      for (const l of windowLessons) {
        const jsDay = new Date(l.date + 'T12:00:00').getDay()
        const weekday = JS_DAY_TO_WEEKDAY[jsDay]
        const key = `${l.date}|${l.start_time?.slice(0,5)}`

        // Duration from start/end
        const [sh, sm] = (l.start_time ?? '').split(':').map(Number)
        const [eh, em] = (l.end_time ?? '').split(':').map(Number)
        const dur = (eh * 60 + em) - (sh * 60 + sm)

        derived.push({
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
        })
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
        })
      }

      setSchedules(derived)
      setLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  function updateSchedule(index: number, key: keyof Omit<Schedule, 'key'>, value: string | boolean) {
    setSchedules(prev => prev.map((s, i) => i === index ? { ...s, [key]: value } : s))
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
          name: courseName,
          teacher_id: teacherId || null,
          description: description || null,
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
          schedules: updateFutureClasses ? schedules.map(s => ({
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
          })) : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong')
        setSubmitting(false)
      } else {
        router.push(`/school/courses/${id}`)
      }
    } catch (err) {
      console.error('[edit course] submit error:', err)
      setError('Unexpected error')
      setSubmitting(false)
    }
  }

  const inputCls = 'w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20'
  const labelCls = 'block text-sm font-medium text-gray-700 mb-1'

  if (loading) {
    return (
      <div className="max-w-2xl">
        <div className="mb-6">
          <Link href={`/school/courses/${id}`} className="text-sm text-gray-400 hover:text-gray-600">← Back to Course</Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-2">Edit Course</h1>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-gray-400 text-sm">Loading...</div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="mb-6">
        <Link href={`/school/courses/${id}`} className="text-sm text-gray-400 hover:text-gray-600">← Back to Course</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">Edit Course</h1>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}

      {/* Course-level fields */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-5">
        <h2 className="text-sm font-semibold text-gray-700">Course Details</h2>
        <div>
          <label className={labelCls}>Lesson Type *</label>
          <select
            value={lessonTypeId}
            onChange={(e) => {
              const selected = lessonTypes.find(lt => lt.id === e.target.value)
              setLessonTypeId(e.target.value)
              setCourseName(selected?.name_it ?? selected?.name_en ?? courseName)
            }}
            className={inputCls}
          >
            <option value="">Select lesson type...</option>
            {lessonTypes.map((lt) => (
              <option key={lt.id} value={lt.id}>{lt.name_it || lt.name_en}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Default Teacher</label>
          <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} className={inputCls}>
            <option value="">No teacher assigned</option>
            {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputCls} placeholder="Optional course description..." />
        </div>
      </div>

      {/* Schedules */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">Class Schedules</h2>
        <p className="text-xs text-gray-400">Each schedule represents a unique day/time combination detected from upcoming classes.</p>

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
                  <p className="text-sm font-medium text-gray-900">Schedule {idx + 1}</p>
                  <p className="text-xs text-gray-400">{scheduleLabel(sched)}</p>
                </div>
              </div>
              <span className="text-gray-300 text-sm">{openSchedule === idx ? '▲' : '▼'}</span>
            </div>

            {/* Form */}
            {openSchedule === idx && (
              <div className="px-5 pb-5 pt-1 space-y-4 border-t border-gray-50">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Start Time</label>
                    <input type="time" value={sched.start_time}
                      onChange={(e) => updateSchedule(idx, 'start_time', e.target.value)}
                      className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Duration (min)</label>
                    <input type="number" min="15" step="15" value={sched.duration_minutes}
                      onChange={(e) => updateSchedule(idx, 'duration_minutes', e.target.value)}
                      className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Max Capacity</label>
                    <input type="number" min="1" value={sched.max_capacity}
                      onChange={(e) => updateSchedule(idx, 'max_capacity', e.target.value)}
                      className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Credit Cost per Class</label>
                    <input type="number" min="1" value={sched.credit_cost}
                      onChange={(e) => updateSchedule(idx, 'credit_cost', e.target.value)}
                      className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>VIP Early Booking (hours)</label>
                    <input type="number" min="0" value={sched.vip_booking_hours_before}
                      onChange={(e) => updateSchedule(idx, 'vip_booking_hours_before', e.target.value)}
                      className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Min Booking Notice (hours)</label>
                    <input type="number" min="0" value={sched.min_booking_notice_hours}
                      onChange={(e) => updateSchedule(idx, 'min_booking_notice_hours', e.target.value)}
                      className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Room</label>
                    <select value={sched.room_id}
                      onChange={(e) => updateSchedule(idx, 'room_id', e.target.value)}
                      className={inputCls}>
                      <option value="">No room assigned</option>
                      {rooms.map((r) => <option key={r.id} value={r.id}>{r.location_name} — {r.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Teacher Override</label>
                    <select value={sched.teacher_id}
                      onChange={(e) => updateSchedule(idx, 'teacher_id', e.target.value)}
                      className={inputCls}>
                      <option value="">Use course default</option>
                      {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Reserve Spots</label>
                    <input type="number" min="0" value={sched.reserve_spots}
                      onChange={(e) => updateSchedule(idx, 'reserve_spots', e.target.value)}
                      className={inputCls} />
                  </div>
                </div>

                {/* Weekday (read-only info) */}
                {sched.weekday && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-500">Day:</span>
                    {WEEKDAYS.map(w => (
                      <button
                        key={w.value}
                        type="button"
                        onClick={() => updateSchedule(idx, 'weekday', w.value)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                          sched.weekday === w.value
                            ? 'bg-[#6B1F3A] text-white border-[#6B1F3A]'
                            : 'border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}
                      >
                        {w.label}
                      </button>
                    ))}
                  </div>
                )}

                {/* Color */}
                <div>
                  <label className={labelCls}>Calendar Color</label>
                  <div className="flex gap-2 mt-1">
                    {COLORS.map((c) => (
                      <button key={c} type="button"
                        onClick={() => updateSchedule(idx, 'color', c)}
                        className={`w-8 h-8 rounded-full transition ${sched.color === c ? 'ring-2 ring-offset-2 ring-gray-400' : ''}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>

                {/* Waitlist */}
                <label className="flex items-center gap-3 cursor-pointer">
                  <div className="relative">
                    <input type="checkbox" className="sr-only"
                      checked={sched.waitlist_enabled}
                      onChange={(e) => updateSchedule(idx, 'waitlist_enabled', e.target.checked)} />
                    <div className={`w-10 h-6 rounded-full transition ${sched.waitlist_enabled ? 'bg-[#6B1F3A]' : 'bg-gray-200'}`} />
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${sched.waitlist_enabled ? 'left-5' : 'left-1'}`} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700">Enable Waitlist</p>
                    <p className="text-xs text-gray-400">Students can join when class is full.</p>
                  </div>
                </label>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex justify-between">
        <Link href={`/school/courses/${id}`}
          className="px-5 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition">
          Cancel
        </Link>
        <button
          type="button"
          onClick={() => setShowPropagationDialog(true)}
          disabled={submitting}
          className="px-6 py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
        >
          {submitting ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {/* Propagation dialog */}
      {showPropagationDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <h3 className="font-semibold text-gray-900 text-base">Apply changes to classes?</h3>
            <p className="text-sm text-gray-500">
              Do you want to apply these changes to all future classes, or only update the course template?
            </p>
            <div className="flex flex-col gap-2 pt-1">
              <button onClick={() => handleSubmit(true)}
                className="w-full px-4 py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition">
                Update course + all future classes
              </button>
              <button onClick={() => handleSubmit(false)}
                className="w-full px-4 py-2.5 border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition">
                Update course template only
              </button>
              <button onClick={() => setShowPropagationDialog(false)}
                className="w-full px-4 py-2.5 text-gray-400 rounded-lg text-sm hover:bg-gray-50 transition">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
