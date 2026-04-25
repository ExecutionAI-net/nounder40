'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

type LessonType = { id: string; code: string; name_en: string; name_it: string }
type Teacher = { id: string; name: string }
type Room = { id: string; name: string; capacity: number; location_name: string }
type Plan = { id: string; name: string }
type HQCountry = { id: string; name: string; code: string }
type HQCity = { id: string; country_id: string; name: string }

type Schedule = {
  start_date: string
  start_time: string
  duration_minutes: string
  end_date: string
  frequency: string
  weekday: string   // 'monday' | 'tuesday' | ... | '' (for single/intensive)
  room_id: string
  teacher_id: string
  max_capacity: string
  credit_cost: string
  vip_booking_hours_before: string
  min_booking_notice_hours: string
  color: string
  reserve_spots: string
  waitlist_enabled: boolean
  compensation_plan_id: string
}

const LANGUAGES = [
  { value: 'it', label: 'Italiano' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
]

const COLORS = ['#6B1F3A', '#1F3A6B', '#1F6B3A', '#6B5A1F', '#3A1F6B', '#1F6B5A', '#6B1F1F', '#4A4A4A']

const DEFAULT_SCHEDULE: Schedule = {
  start_date: '', start_time: '', duration_minutes: '60',
  end_date: '', frequency: 'weekly', weekday: '',
  room_id: '', teacher_id: '',
  max_capacity: '15', credit_cost: '1', color: '#6B1F3A',
  vip_booking_hours_before: '0', min_booking_notice_hours: '2',
  reserve_spots: '0', waitlist_enabled: false,
  compensation_plan_id: '',
}

function fmtDate(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export default function NewCoursePage() {
  const t = useTranslations('school.courses.new')
  const router = useRouter()
  const supabase = createClient()

  const STEPS = [t('stepBasicDetails'), t('stepSchedules')]

  const WEEKDAYS = [
    { value: 'monday', label: t('monday') },
    { value: 'tuesday', label: t('tuesday') },
    { value: 'wednesday', label: t('wednesday') },
    { value: 'thursday', label: t('thursday') },
    { value: 'friday', label: t('friday') },
    { value: 'saturday', label: t('saturday') },
    { value: 'sunday', label: t('sunday') },
  ]

  const FREQ_OPTIONS = [
    { value: 'single', label: t('freqSingle'), desc: t('freqSingleDesc') },
    { value: 'weekly', label: t('freqWeekly'), desc: t('freqWeeklyDesc') },
    { value: 'biweekly', label: t('freqBiweekly'), desc: t('freqBiweeklyDesc') },
    { value: 'intensive', label: t('freqIntensive'), desc: t('freqIntensiveDesc') },
  ]

  function scheduleLabel(s: Schedule): string {
    if (!s.start_date || !s.start_time) return t('notConfigured')
    const freqLabel = FREQ_OPTIONS.find(f => f.value === s.frequency)?.label ?? s.frequency
    const weekdayLabel = (s.frequency === 'weekly' || s.frequency === 'biweekly')
      ? (WEEKDAYS.find(w => w.value === s.weekday)?.label ?? '')
      : ''
    const dayPart = weekdayLabel ? ` ${weekdayLabel}` : ''
    const end = s.end_date ? ` → ${fmtDate(s.end_date)}` : (s.frequency !== 'single' ? t('forOneYear') : '')
    return `${freqLabel}${dayPart} · ${s.start_time} · ${s.duration_minutes}min · from ${fmtDate(s.start_date)}${end}`
  }

  const [step, setStep] = useState(0)
  const [lessonTypes, setLessonTypes] = useState<LessonType[]>([])
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [schoolId, setSchoolId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hqCountries, setHqCountries] = useState<HQCountry[]>([])
  const [hqCities, setHqCities] = useState<HQCity[]>([])

  // Step 1 fields
  const [lessonTypeId, setLessonTypeId] = useState('')
  const [courseName, setCourseName] = useState('')
  const [teacherId, setTeacherId] = useState('')
  const [description, setDescription] = useState('')
  const [notes, setNotes] = useState('')
  const [isOnline, setIsOnline] = useState(false)
  const [onlineLink, setOnlineLink] = useState('')
  const [language, setLanguage] = useState('it')
  const [courseCountry, setCourseCountry] = useState('')
  const [courseCity, setCourseCity] = useState('')

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

      const [lt, th, loc, pl, school] = await Promise.all([
        supabase.from('lesson_types').select('id, code, name_en, name_it').eq('active', true).order('name_en'),
        supabase.from('teachers').select('id, name').eq('school_id', profile.school_id).eq('active', true).order('name'),
        supabase.from('school_locations').select('id, name, school_rooms(id, name, capacity)').eq('school_id', profile.school_id),
        supabase.from('compensation_plans').select('id, name').eq('school_id', profile.school_id).order('name'),
        supabase.from('schools').select('language, country, city').eq('id', profile.school_id).single(),
      ])

      if (school.data?.language) setLanguage(school.data.language)
      if (school.data?.country) setCourseCountry(school.data.country)
      if (school.data?.city) setCourseCity(school.data.city)

      const locRes = await fetch('/api/locations')
      if (locRes.ok) {
        const loc = await locRes.json()
        setHqCountries(loc.countries ?? [])
        setHqCities(loc.cities ?? [])
      }

      setLessonTypes(lt.data ?? [])
      setTeachers(th.data ?? [])
      setPlans(pl.data ?? [])

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
        notes: notes || null,
        is_online: isOnline,
        online_link: onlineLink || null,
        language,
        country: courseCountry || null,
        city: courseCity || null,
        schedules: schedules.map(s => ({
          frequency: s.frequency,
          weekday: s.weekday || undefined,
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
          compensation_plan_id: s.compensation_plan_id || undefined,
        })),
      }),
    })

    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? 'Something went wrong')
      setSubmitting(false)
    } else {
      router.refresh()
      router.push('/school/courses')
    }
  }

  const inputCls = 'w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20'
  const labelCls = 'block text-sm font-medium text-gray-700 mb-1'

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link href="/school/courses" className="text-sm text-gray-400 hover:text-gray-600">{t('backToCourses')}</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">{t('title')}</h1>
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
            <label className={labelCls}>{t('labelLessonType')}</label>
            <select
              value={lessonTypeId}
              onChange={(e) => {
                const selected = lessonTypes.find(lt => lt.id === e.target.value)
                setLessonTypeId(e.target.value)
                setCourseName(selected?.name_it ?? selected?.name_en ?? '')
              }}
              className={inputCls}
            >
              <option value="">{t('selectLessonType')}</option>
              {lessonTypes.map((lt) => (
                <option key={lt.id} value={lt.id}>{lt.name_it || lt.name_en}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>{t('labelDefaultTeacher')}</label>
            <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} className={inputCls}>
              <option value="">{t('selectTeacher')}</option>
              {teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}
            </select>
            <p className="text-xs text-gray-400 mt-1">{t('teacherOverrideHint')}</p>
          </div>
          <div>
            <label className={labelCls}>{t('labelLanguage')}</label>
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className={inputCls}>
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">{t('languageHint')}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>{t('labelCountry')}</label>
              {hqCountries.length === 0 ? (
                <input value={courseCountry} onChange={(e) => setCourseCountry(e.target.value)} className={inputCls} placeholder={t('countryPlaceholder')} />
              ) : (
                <select
                  value={courseCountry}
                  onChange={(e) => { setCourseCountry(e.target.value); setCourseCity('') }}
                  className={inputCls}
                >
                  <option value="">{t('selectCountry')}</option>
                  {hqCountries.map((c) => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className={labelCls}>{t('labelCity')}</label>
              {hqCountries.length === 0 ? (
                <input value={courseCity} onChange={(e) => setCourseCity(e.target.value)} className={inputCls} placeholder={t('cityPlaceholder')} />
              ) : (() => {
                const matched = hqCountries.find((c) => c.name === courseCountry)
                const filtered = matched ? hqCities.filter((c) => c.country_id === matched.id) : []
                return (
                  <select
                    value={courseCity}
                    onChange={(e) => setCourseCity(e.target.value)}
                    disabled={!courseCountry || filtered.length === 0}
                    className={`${inputCls} disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {!courseCountry ? (
                      <option value="">{t('selectCountryFirst')}</option>
                    ) : filtered.length === 0 ? (
                      <option value="">{t('noCities')}</option>
                    ) : (
                      <>
                        <option value="">{t('selectCity')}</option>
                        {filtered.map((c) => (
                          <option key={c.id} value={c.name}>{c.name}</option>
                        ))}
                      </>
                    )}
                  </select>
                )
              })()}
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
          <div>
            <label className={labelCls}>Online Course</label>
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
                    <p className="text-sm font-medium text-gray-900">{t('scheduleNumber', { num: idx + 1 })}</p>
                    <p className="text-xs text-gray-400">{scheduleLabel(sched)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {schedules.length > 1 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); removeSchedule(idx) }}
                      className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 transition"
                    >
                      {t('remove')}
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
                    <label className={labelCls}>{t('labelFrequency')}</label>
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

                  {/* Weekday selector — only for weekly / biweekly */}
                  {(sched.frequency === 'weekly' || sched.frequency === 'biweekly') && (
                    <div>
                      <label className={labelCls}>{t('labelDayOfWeek')}</label>
                      <div className="flex flex-wrap gap-2 mt-1">
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
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>{t('labelStartDate')}</label>
                      <input type="date" value={sched.start_date} onChange={(e) => updateSchedule(idx, 'start_date', e.target.value)} className={inputCls} />
                    </div>
                    {sched.frequency !== 'single' && (
                      <div>
                        <label className={labelCls}>{t('labelEndDate')} {sched.frequency === 'intensive' ? '*' : t('endDateBlank')}</label>
                        <input type="date" value={sched.end_date} onChange={(e) => updateSchedule(idx, 'end_date', e.target.value)} className={inputCls} />
                      </div>
                    )}
                    <div>
                      <label className={labelCls}>{t('labelStartTime')}</label>
                      <input type="time" value={sched.start_time} onChange={(e) => updateSchedule(idx, 'start_time', e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>{t('labelDuration')}</label>
                      <input type="number" min="15" step="15" value={sched.duration_minutes} onChange={(e) => updateSchedule(idx, 'duration_minutes', e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>{t('labelMaxCapacity')}</label>
                      <input type="number" min="1" value={sched.max_capacity} onChange={(e) => updateSchedule(idx, 'max_capacity', e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>{t('labelCreditCost')}</label>
                      <input type="number" min="1" value={sched.credit_cost} onChange={(e) => updateSchedule(idx, 'credit_cost', e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>{t('labelVipBooking')}</label>
                      <input type="number" min="0" value={sched.vip_booking_hours_before} onChange={(e) => updateSchedule(idx, 'vip_booking_hours_before', e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>{t('labelMinNotice')}</label>
                      <input type="number" min="0" value={sched.min_booking_notice_hours} onChange={(e) => updateSchedule(idx, 'min_booking_notice_hours', e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>{t('labelRoom')}</label>
                      <select value={sched.room_id} onChange={(e) => updateSchedule(idx, 'room_id', e.target.value)} className={inputCls}>
                        <option value="">{t('noRoomAssigned')}</option>
                        {rooms.map((r) => <option key={r.id} value={r.id}>{r.location_name} — {r.name} (cap. {r.capacity})</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>{t('labelTeacherOverride')}</label>
                      <select value={sched.teacher_id} onChange={(e) => updateSchedule(idx, 'teacher_id', e.target.value)} className={inputCls}>
                        <option value="">{t('useCourseDefault')}</option>
                        {teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}
                      </select>
                    </div>
                    {plans.length > 0 && (
                      <div>
                        <label className={labelCls}>{t('labelCompPlan')}</label>
                        <select value={sched.compensation_plan_id} onChange={(e) => updateSchedule(idx, 'compensation_plan_id', e.target.value)} className={inputCls}>
                          <option value="">{t('noPlan')}</option>
                          {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Color */}
                  <div>
                    <label className={labelCls}>{t('labelCalendarColor')}</label>
                    <div className="flex gap-2 mt-1 flex-wrap items-center">
                      {COLORS.map((c) => (
                        <button key={c} type="button" onClick={() => updateSchedule(idx, 'color', c)}
                          className="w-8 h-8 rounded-full border-2 transition"
                          style={{ backgroundColor: c, borderColor: sched.color === c ? '#1f2937' : 'transparent' }}
                        />
                      ))}
                      <label
                        className="w-8 h-8 rounded-full border-2 border-dashed border-gray-300 cursor-pointer overflow-hidden relative flex items-center justify-center hover:border-gray-400 transition"
                        title="Custom color"
                        style={!COLORS.includes(sched.color) ? { borderColor: '#1f2937', borderStyle: 'solid', backgroundColor: sched.color } : {}}
                      >
                        <input type="color" value={sched.color} onChange={e => updateSchedule(idx, 'color', e.target.value)}
                          className="absolute opacity-0 w-full h-full cursor-pointer" />
                        {COLORS.includes(sched.color) && <span className="text-gray-400 text-xs leading-none select-none">+</span>}
                      </label>
                    </div>
                  </div>

                  {/* Reserve spots & waitlist */}
                  <div className="grid grid-cols-2 gap-3 pt-1 border-t border-gray-50">
                    <div>
                      <label className={labelCls}>{t('labelReserveSpots')}</label>
                      <input type="number" min="0" value={sched.reserve_spots}
                        onChange={(e) => updateSchedule(idx, 'reserve_spots', e.target.value)}
                        className={inputCls} />
                      <p className="text-xs text-gray-400 mt-1">{t('reserveSpotsHint')}</p>
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
                          <p className="text-sm font-medium text-gray-700">{t('enableWaitlist')}</p>
                          <p className="text-xs text-gray-400">{t('waitlistHint')}</p>
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
            {t('addSchedule')}
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
          {t('back')}
        </button>
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            onClick={() => {
              if (step === 0 && !lessonTypeId) {
                setError(t('errorSelectLessonType'))
                return
              }
              if (step === 1) {
                const missingDate = schedules.find(s => !s.start_date || !s.start_time)
                if (missingDate) {
                  setError(t('errorStartDateTime'))
                  return
                }
                const missingWeekday = schedules.find(
                  s => (s.frequency === 'weekly' || s.frequency === 'biweekly') && !s.weekday
                )
                if (missingWeekday) {
                  setError(t('errorWeekday'))
                  return
                }
              }
              setError(null)
              setStep((s) => s + 1)
            }}
            className="px-5 py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition"
          >
            {t('next')}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="px-6 py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
          >
            {submitting ? t('creating') : t('createCourse')}
          </button>
        )}
      </div>
    </div>
  )
}
