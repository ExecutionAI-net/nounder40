'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

type LessonType = { id: string; code: string; name_en: string; name_it: string }
type Teacher = { id: string; name: string }
type Room = { id: string; name: string; capacity: number; location_name: string }

const STEPS = ['Basic Details', 'Schedule & Capacity', 'Frequency', 'Options']
const COLORS = ['#6B1F3A', '#1F3A6B', '#1F6B3A', '#6B5A1F', '#3A1F6B', '#1F6B5A', '#6B1F1F', '#4A4A4A']

export default function NewCoursePage() {
  const router = useRouter()
  const supabase = createClient()
  const [step, setStep] = useState(0)
  const [lessonTypes, setLessonTypes] = useState<LessonType[]>([])
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [schoolId, setSchoolId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    // Step 1
    lesson_type_id: '', teacher_id: '', name: '', description: '',
    // Step 2
    start_date: '', room_id: '', start_time: '', duration_minutes: '60',
    max_capacity: '15', credit_cost: '1', color: '#6B1F3A',
    vip_booking_hours_before: '0', min_booking_notice_hours: '2',
    // Step 3
    frequency: 'weekly', end_date: '',
    // Step 4
    waitlist_enabled: false, reserve_spots: '0',
  })

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
      if (!profile?.school_id) return
      setSchoolId(profile.school_id)

      const [lt, th, loc] = await Promise.all([
        supabase.from('lesson_types').select('id, code, name_en, name_it').eq('active', true).order('name_en'),
        supabase.from('teachers').select('id, name').eq('school_id', profile.school_id).eq('active', true).order('name'),
        supabase.from('school_locations').select('id, name, school_rooms(id, name, capacity)').eq('school_id', profile.school_id),
      ])

      setLessonTypes(lt.data ?? [])
      setTeachers(th.data ?? [])

      const flatRooms: Room[] = []
      for (const location of loc.data ?? []) {
        for (const room of (location.school_rooms as { id: string; name: string; capacity: number }[] ?? [])) {
          flatRooms.push({ id: room.id, name: room.name, capacity: room.capacity, location_name: location.name })
        }
      }
      setRooms(flatRooms)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function set(key: string, value: string | boolean) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSubmit() {
    if (!schoolId) return
    setSubmitting(true)
    setError(null)
    const res = await fetch('/api/school/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? 'Something went wrong')
      setSubmitting(false)
    } else {
      router.push('/school/calendar')
    }
  }

  const inputCls = 'w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20'
  const labelCls = 'block text-sm font-medium text-gray-700 mb-1'

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link href="/school/calendar" className="text-sm text-gray-400 hover:text-gray-600">← Back to Calendar</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">New Course</h1>
      </div>

      {/* Step indicator */}
      <div className="flex items-center mb-8">
        {STEPS.map((s, i) => (
          <div key={i} className="flex items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition ${
              i < step ? 'bg-[#6B1F3A] text-white' :
              i === step ? 'bg-[#6B1F3A] text-white ring-4 ring-[#6B1F3A]/20' :
              'bg-gray-100 text-gray-400'
            }`}>
              {i < step ? '✓' : i + 1}
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-0.5 w-16 mx-1 ${i < step ? 'bg-[#6B1F3A]' : 'bg-gray-200'}`} />
            )}
          </div>
        ))}
        <span className="ml-4 text-sm text-gray-500">{STEPS[step]}</span>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}

      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-5">
        {/* Step 1: Basic Details */}
        {step === 0 && (
          <>
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
                <option value="">Select teacher (optional)...</option>
                {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Description</label>
              <textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={2} className={inputCls} placeholder="Optional course description..." />
            </div>
          </>
        )}

        {/* Step 2: Schedule & Capacity */}
        {step === 1 && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Start Date *</label>
                <input type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} className={inputCls} />
              </div>
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
          </>
        )}

        {/* Step 3: Frequency */}
        {step === 2 && (
          <>
            <div>
              <label className={labelCls}>Frequency</label>
              <div className="grid grid-cols-2 gap-3 mt-1">
                {[
                  { value: 'single', label: 'Single Lesson', desc: 'One-time lesson on the start date' },
                  { value: 'weekly', label: 'Weekly', desc: 'Every week on the same day' },
                  { value: 'biweekly', label: 'Bi-weekly', desc: 'Every two weeks' },
                  { value: 'intensive', label: 'Intensive / Workshop', desc: 'Custom dates (set end date)' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => set('frequency', opt.value)}
                    className={`p-4 rounded-xl border-2 text-left transition ${
                      form.frequency === opt.value
                        ? 'border-[#6B1F3A] bg-[#6B1F3A]/5'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <p className={`font-medium text-sm ${form.frequency === opt.value ? 'text-[#6B1F3A]' : 'text-gray-800'}`}>{opt.label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>
            {form.frequency !== 'single' && (
              <div>
                <label className={labelCls}>End Date {form.frequency === 'weekly' || form.frequency === 'biweekly' ? '(leave blank for 1 year)' : '*'}</label>
                <input type="date" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} className={inputCls} />
              </div>
            )}
            {form.start_date && (
              <div className="p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
                {form.frequency === 'single' && `1 lesson on ${form.start_date}`}
                {form.frequency === 'weekly' && `Weekly lessons from ${form.start_date}${form.end_date ? ` to ${form.end_date}` : ' for 1 year'}`}
                {form.frequency === 'biweekly' && `Bi-weekly lessons from ${form.start_date}${form.end_date ? ` to ${form.end_date}` : ' for 1 year'}`}
                {form.frequency === 'intensive' && `Lessons from ${form.start_date}${form.end_date ? ` to ${form.end_date}` : ''}`}
              </div>
            )}
          </>
        )}

        {/* Step 4: Options */}
        {step === 3 && (
          <>
            <div>
              <label className={labelCls}>Reserve Spots (for make-up lessons)</label>
              <input type="number" min="0" value={form.reserve_spots} onChange={(e) => set('reserve_spots', e.target.value)} className={inputCls} />
              <p className="text-xs text-gray-400 mt-1">These spots are held and not shown as available for regular booking.</p>
            </div>
            <label className="flex items-center gap-3 cursor-pointer mt-2">
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

            <div className="mt-4 p-4 bg-gray-50 rounded-xl space-y-2 text-sm">
              <p className="font-medium text-gray-700">Summary</p>
              <p className="text-gray-500"><span className="text-gray-700">Course:</span> {form.name}</p>
              <p className="text-gray-500"><span className="text-gray-700">Schedule:</span> {form.start_time} · {form.duration_minutes} min · {form.frequency}</p>
              <p className="text-gray-500"><span className="text-gray-700">Capacity:</span> {form.max_capacity} students · {form.credit_cost} credit(s)</p>
            </div>
          </>
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-between mt-5">
        <button
          type="button"
          onClick={() => setStep((s) => s - 1)}
          disabled={step === 0}
          className="px-5 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 disabled:opacity-30"
        >
          ← Back
        </button>
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            onClick={() => {
              if (step === 0 && (!form.lesson_type_id || !form.name)) {
                setError('Lesson type and course name are required.')
                return
              }
              if (step === 1 && (!form.start_date || !form.start_time)) {
                setError('Start date and start time are required.')
                return
              }
              setError(null)
              setStep((s) => s + 1)
            }}
            className="px-5 py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition"
          >
            Next →
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="px-6 py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
          >
            {submitting ? 'Creating...' : 'Create Course'}
          </button>
        )}
      </div>
    </div>
  )
}
