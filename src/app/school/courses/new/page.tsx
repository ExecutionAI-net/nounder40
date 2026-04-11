'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

type LessonType = { id: string; code: string; name_en: string; name_it: string }
type Teacher = { id: string; name: string }
type Room = { id: string; name: string; capacity: number; location_name: string }

type Schedule = {
  start_date: string
  start_time: string
  duration_minutes: string
  end_date: string
  frequency: string
  room_id: string
  teacher_id: string
  max_capacity: string
  credit_cost: string
  vip_booking_hours_before: string
  min_booking_notice_hours: string
  color: string
  reserve_spots: string
  waitlist_enabled: boolean
}

const STEPS = ['Basic Details', 'Class Schedules']
const COLORS = ['#6B1F3A', '#1F3A6B', '#1F6B3A', '#6B5A1F', '#3A1F6B', '#1F6B5A', '#6B1F1F', '#4A4A4A']

const DEFAULT_SCHEDULE: Schedule = {
  start_date: '', start_time: '', duration_minutes: '60',
  end_date: '', frequency: 'weekly',
  room_id: '', teacher_id: '',
  max_capacity: '15', credit_cost: '1', color: '#6B1F3A',
  vip_booking_hours_before: '0', min_booking_notice_hours: '2',
  reserve_spots: '0', waitlist_enabled: false,
}

const FREQ_OPTIONS = [
  { value: 'single', label: 'Single Class', desc: 'One-time class on the start date' },
  { value: 'weekly', label: 'Weekly', desc: 'Every week on the same day' },
  { value: 'biweekly', label: 'Bi-weekly', desc: 'Every two weeks' },
  { value: 'intensive', label: 'Intensive / Workshop', desc: 'Custom dates (set end date)' },
]

function scheduleLabel(s: Schedule): string {
  if (!s.start_date || !s.start_time) return 'Not configured'
  const freq = FREQ_OPTIONS.find(f => f.value === s.frequency)?.label ?? s.frequency
  const end = s.end_date ? ` → ${s.end_date}` : (s.frequency !== 'single' ? ' for 1 year' : '')
  return `${freq} · ${s.start_time} · ${s.duration_minutes}min · from ${s.start_date}${end}`
}

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

  // Step 1 fields
  const [lessonTypeId, setLessonTypeId] = useState('')
  const [courseName, setCourseName] = useState('')
  const [teacherId, setTeacherId] = useState('')
  const [description, setDescription] = useState('')

  // Step 2: multiple schedules
  const [schedules, setSchedules] = useState<Schedule[]>([{ ...DEFAULT_SCHEDULE }])
  const [openSchedule, setOpenSchedule] = useState<number>(0)


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

  function updateSchedule(index: number, key: keyof Schedule, value: string) {
    setSchedules(prev => prev.map((s, i) => i === index ? { ...s, [key]: value } : s))
  }

  function addSchedule() {
    const last = schedules[schedules.length - 1]
    setSchedules(prev => [...prev, { ...last }])
    setOpenSchedule(schedules.length)
  }

  function removeSchedule(index: number) {
    if (schedules.length <= 1) return
    setSchedules(prev => prev.filter((_, i) => i !== index))
    setOpenSchedule(Math.max(0, openSchedule >= index ? openSchedule - 1 : openSchedule))
  }

  async function handleSubmit() {
    if (!schoolId) return
    setSubmitting(true)
    setError(null)

    const res = await fetch('/api/school/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lesson_type_id: lessonTypeId,
        name: courseName,
        teacher_id: teacherId || null,
        description: description || null,
        schedules: schedules.map(s => ({
          frequency: s.frequency,
          start_date: s.start_date,
          end_date: s.end_date || undefined,
          start_time: s.start_time,
          duration_minutes: Number(s.duration_minutes),
          max_capacity: Number(s.max_capacity),
          credit_cost: Number(s.credit_cost),
          color: s.color,
          vip_booking_hours_before: Number(s.vip_booking_hours_before),
          min_booking_notice_hours: Number(s.min_booking_notice_hours),
          room_id: s.room_id || undefined,
          teacher_id: s.teacher_id || undefined,
          reserve_spots: Number(s.reserve_spots),
          waitlist_enabled: s.waitlist_enabled,
        })),
      }),
    })

    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? 'Something went wrong')
      setSubmitting(false)
    } else {
      router.push('/school/courses')
    }
  }

  const inputCls = 'w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20'
  const labelCls = 'block text-sm font-medium text-gray-700 mb-1'

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link href="/school/courses" className="text-sm text-gray-400 hover:text-gray-600">← Back to Courses</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">New Course</h1>
      </div>

      {/* Step indicator */}
      <div className="flex items-center mb-8">
        {STEPS.map((_s, i) => (
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

      {/* Step 1: Basic Details */}
      {step === 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-5">
          <div>
            <label className={labelCls}>Lesson Type *</label>
            <select
              value={lessonTypeId}
              onChange={(e) => {
                const selected = lessonTypes.find(lt => lt.id === e.target.value)
                setLessonTypeId(e.target.value)
                setCourseName(selected?.name_it ?? selected?.name_en ?? '')
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
              <option value="">Select teacher (optional)...</option>
              {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <p className="text-xs text-gray-400 mt-1">Can be overridden per schedule.</p>
          </div>
          <div>
            <label className={labelCls}>Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputCls} placeholder="Optional course description..." />
          </div>
        </div>
      )}

      {/* Step 2: Class Schedules */}
      {step === 1 && (
        <div className="space-y-4">
          {schedules.map((sched, idx) => (
            <div key={idx} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              {/* Schedule header */}
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
                <div className="flex items-center gap-2">
                  {schedules.length > 1 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); removeSchedule(idx) }}
                      className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 transition"
                    >
                      Remove
                    </button>
                  )}
                  <span className="text-gray-300 text-sm">{openSchedule === idx ? '▲' : '▼'}</span>
                </div>
              </div>

              {/* Schedule form */}
              {openSchedule === idx && (
                <div className="px-5 pb-5 pt-1 space-y-4 border-t border-gray-50">
                  {/* Frequency */}
                  <div>
                    <label className={labelCls}>Frequency</label>
                    <div className="grid grid-cols-2 gap-2 mt-1">
                      {FREQ_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => updateSchedule(idx, 'frequency', opt.value)}
                          className={`p-3 rounded-xl border-2 text-left transition ${
                            sched.frequency === opt.value
                              ? 'border-[#6B1F3A] bg-[#6B1F3A]/5'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <p className={`font-medium text-xs ${sched.frequency === opt.value ? 'text-[#6B1F3A]' : 'text-gray-800'}`}>{opt.label}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{opt.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Start Date *</label>
                      <input type="date" value={sched.start_date} onChange={(e) => updateSchedule(idx, 'start_date', e.target.value)} className={inputCls} />
                    </div>
                    {sched.frequency !== 'single' && (
                      <div>
                        <label className={labelCls}>End Date {sched.frequency === 'intensive' ? '*' : '(blank = 1 year)'}</label>
                        <input type="date" value={sched.end_date} onChange={(e) => updateSchedule(idx, 'end_date', e.target.value)} className={inputCls} />
                      </div>
                    )}
                    <div>
                      <label className={labelCls}>Start Time *</label>
                      <input type="time" value={sched.start_time} onChange={(e) => updateSchedule(idx, 'start_time', e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Duration (min)</label>
                      <input type="number" min="15" step="15" value={sched.duration_minutes} onChange={(e) => updateSchedule(idx, 'duration_minutes', e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Max Capacity</label>
                      <input type="number" min="1" value={sched.max_capacity} onChange={(e) => updateSchedule(idx, 'max_capacity', e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Credit Cost per Class</label>
                      <input type="number" min="1" value={sched.credit_cost} onChange={(e) => updateSchedule(idx, 'credit_cost', e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>VIP Early Booking (hours)</label>
                      <input type="number" min="0" value={sched.vip_booking_hours_before} onChange={(e) => updateSchedule(idx, 'vip_booking_hours_before', e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Min Booking Notice (hours)</label>
                      <input type="number" min="0" value={sched.min_booking_notice_hours} onChange={(e) => updateSchedule(idx, 'min_booking_notice_hours', e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Room</label>
                      <select value={sched.room_id} onChange={(e) => updateSchedule(idx, 'room_id', e.target.value)} className={inputCls}>
                        <option value="">No room assigned</option>
                        {rooms.map((r) => <option key={r.id} value={r.id}>{r.location_name} — {r.name} (cap. {r.capacity})</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Teacher Override</label>
                      <select value={sched.teacher_id} onChange={(e) => updateSchedule(idx, 'teacher_id', e.target.value)} className={inputCls}>
                        <option value="">Use course default</option>
                        {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Color */}
                  <div>
                    <label className={labelCls}>Calendar Color</label>
                    <div className="flex gap-2 mt-1">
                      {COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => updateSchedule(idx, 'color', c)}
                          className={`w-8 h-8 rounded-full transition ${sched.color === c ? 'ring-2 ring-offset-2 ring-gray-400' : ''}`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Reserve spots & waitlist */}
                  <div className="grid grid-cols-2 gap-3 pt-1 border-t border-gray-50">
                    <div>
                      <label className={labelCls}>Reserve Spots</label>
                      <input type="number" min="0" value={sched.reserve_spots}
                        onChange={(e) => updateSchedule(idx, 'reserve_spots', e.target.value)}
                        className={inputCls} />
                      <p className="text-xs text-gray-400 mt-1">Held for make-up classes, not shown as available.</p>
                    </div>
                    <div className="flex flex-col justify-center">
                      <label className="flex items-center gap-3 cursor-pointer mt-4">
                        <div className="relative">
                          <input type="checkbox" className="sr-only"
                            checked={sched.waitlist_enabled}
                            onChange={(e) => setSchedules(prev => prev.map((s, i) => i === idx ? { ...s, waitlist_enabled: e.target.checked } : s))} />
                          <div className={`w-10 h-6 rounded-full transition ${sched.waitlist_enabled ? 'bg-[#6B1F3A]' : 'bg-gray-200'}`} />
                          <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${sched.waitlist_enabled ? 'left-5' : 'left-1'}`} />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-700">Enable Waitlist</p>
                          <p className="text-xs text-gray-400">Students can join when class is full.</p>
                        </div>
                      </label>
                    </div>
                  </div>

                  {/* Summary */}
                  {sched.start_date && sched.start_time && (
                    <div className="p-3 bg-blue-50 rounded-lg text-xs text-blue-700">
                      {scheduleLabel(sched)}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Add schedule button */}
          <button
            type="button"
            onClick={addSchedule}
            className="w-full py-3 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-400 hover:border-gray-300 hover:text-gray-600 transition"
          >
            + Add Class Schedule
          </button>
        </div>
      )}


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
              if (step === 0 && !lessonTypeId) {
                setError('Please select a lesson type.')
                return
              }
              if (step === 1) {
                const invalid = schedules.find(s => !s.start_date || !s.start_time)
                if (invalid) {
                  setError('Each schedule must have a start date and start time.')
                  return
                }
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
