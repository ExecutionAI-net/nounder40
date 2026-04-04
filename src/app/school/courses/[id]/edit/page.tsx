'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

type LessonType = { id: string; code: string; name_en: string; name_it: string }
type Teacher = { id: string; name: string }
type Room = { id: string; name: string; capacity: number; location_name: string }

const COLORS = ['#6B1F3A', '#1F3A6B', '#1F6B3A', '#6B5A1F', '#3A1F6B', '#1F6B5A', '#6B1F1F', '#4A4A4A']

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

  const [form, setForm] = useState({
    lesson_type_id: '',
    teacher_id: '',
    name: '',
    description: '',
    room_id: '',
    start_time: '',
    duration_minutes: '60',
    max_capacity: '15',
    credit_cost: '1',
    color: '#6B1F3A',
    vip_booking_hours_before: '0',
    min_booking_notice_hours: '2',
    reserve_spots: '0',
    waitlist_enabled: false,
  })

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
      if (!profile?.school_id) return

      const [courseRes, lt, th, loc] = await Promise.all([
        fetch(`/api/school/courses/${id}`),
        supabase.from('lesson_types').select('id, code, name_en, name_it').eq('active', true).order('name_en'),
        supabase.from('teachers').select('id, name').eq('school_id', profile.school_id).eq('active', true).order('name'),
        supabase.from('school_locations').select('id, name, school_rooms(id, name, capacity)').eq('school_id', profile.school_id),
      ])

      if (!courseRes.ok) {
        setError('Course not found')
        setLoading(false)
        return
      }
      const course = await courseRes.json()

      setForm({
        lesson_type_id: course.lesson_type_id ?? '',
        teacher_id: course.teacher_id ?? '',
        name: course.name ?? '',
        description: course.description ?? '',
        room_id: course.room_id ?? '',
        start_time: course.start_time ?? '',
        duration_minutes: String(course.duration_minutes ?? 60),
        max_capacity: String(course.max_capacity ?? 15),
        credit_cost: String(course.credit_cost ?? 1),
        color: course.color ?? '#6B1F3A',
        vip_booking_hours_before: String(course.vip_booking_hours_before ?? 0),
        min_booking_notice_hours: String(course.min_booking_notice_hours ?? 2),
        reserve_spots: String(course.reserve_spots ?? 0),
        waitlist_enabled: course.waitlist_enabled ?? false,
      })

      setLessonTypes(lt.data ?? [])
      setTeachers(th.data ?? [])

      const flatRooms: Room[] = []
      for (const location of loc.data ?? []) {
        for (const room of (location.school_rooms as { id: string; name: string; capacity: number }[] ?? [])) {
          flatRooms.push({ id: room.id, name: room.name, capacity: room.capacity, location_name: location.name })
        }
      }
      setRooms(flatRooms)
      setLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  function set(key: string, value: string | boolean) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/school/courses/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, update_future_lessons: true }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong')
        setSubmitting(false)
      } else {
        router.push('/school/calendar')
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
          <Link href="/school/calendar" className="text-sm text-gray-400 hover:text-gray-600">← Back to Calendar</Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-2">Edit Course</h1>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-gray-400 text-sm">Loading...</div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link href="/school/calendar" className="text-sm text-gray-400 hover:text-gray-600">← Back to Calendar</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">Edit Course</h1>
        <p className="text-gray-500 text-sm mt-0.5">Changes will be applied to all upcoming lessons from today onwards.</p>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}

      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-5">
        {/* Basic Details */}
        <div>
          <label className={labelCls}>Lesson Type *</label>
          <select value={form.lesson_type_id} onChange={(e) => set('lesson_type_id', e.target.value)} className={inputCls}>
            <option value="">Select lesson type...</option>
            {lessonTypes.map((lt) => (
              <option key={lt.id} value={lt.id}>{lt.code} — {lt.name_en}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Course Name *</label>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} className={inputCls} placeholder="e.g. Flexibility Monday Morning" />
        </div>
        <div>
          <label className={labelCls}>Teacher</label>
          <select value={form.teacher_id} onChange={(e) => set('teacher_id', e.target.value)} className={inputCls}>
            <option value="">No teacher assigned</option>
            {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Description</label>
          <textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={2} className={inputCls} placeholder="Optional course description..." />
        </div>

        <hr className="border-gray-100" />

        {/* Schedule & Capacity */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Room</label>
            <select value={form.room_id} onChange={(e) => set('room_id', e.target.value)} className={inputCls}>
              <option value="">No room assigned</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.location_name} — {r.name} (cap. {r.capacity})</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Start Time *</label>
            <input type="time" value={form.start_time} onChange={(e) => set('start_time', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Duration (minutes) *</label>
            <input type="number" min="15" step="15" value={form.duration_minutes} onChange={(e) => set('duration_minutes', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Max Capacity *</label>
            <input type="number" min="1" value={form.max_capacity} onChange={(e) => set('max_capacity', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Credit Cost per Lesson</label>
            <input type="number" min="1" value={form.credit_cost} onChange={(e) => set('credit_cost', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Reserve Spots</label>
            <input type="number" min="0" value={form.reserve_spots} onChange={(e) => set('reserve_spots', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>VIP Early Booking (hours before)</label>
            <input type="number" min="0" value={form.vip_booking_hours_before} onChange={(e) => set('vip_booking_hours_before', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Min Booking Notice (hours)</label>
            <input type="number" min="0" value={form.min_booking_notice_hours} onChange={(e) => set('min_booking_notice_hours', e.target.value)} className={inputCls} />
          </div>
        </div>

        <div>
          <label className={labelCls}>Calendar Color</label>
          <div className="flex gap-2 mt-1">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => set('color', c)}
                className={`w-8 h-8 rounded-full transition ${form.color === c ? 'ring-2 ring-offset-2 ring-gray-400' : ''}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        <label className="flex items-center gap-3 cursor-pointer">
          <div className="relative">
            <input type="checkbox" className="sr-only" checked={form.waitlist_enabled} onChange={(e) => set('waitlist_enabled', e.target.checked)} />
            <div className={`w-10 h-6 rounded-full transition ${form.waitlist_enabled ? 'bg-[#6B1F3A]' : 'bg-gray-200'}`} />
            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${form.waitlist_enabled ? 'left-5' : 'left-1'}`} />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700">Enable Waitlist</p>
            <p className="text-xs text-gray-400">Students can join a waitlist when the lesson is full.</p>
          </div>
        </label>

      </div>

      <div className="flex justify-between mt-5">
        <Link
          href="/school/calendar"
          className="px-5 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition"
        >
          Cancel
        </Link>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="px-6 py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
        >
          {submitting ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}
