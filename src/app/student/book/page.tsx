'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const LANGUAGES = [
  { value: 'it', label: 'Italiano' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
]

const LANG_FLAG: Record<string, string> = { it: '🇮🇹', en: '🇬🇧', es: '🇪🇸' }

type Lesson = {
  id: string
  date: string
  start_time: string
  end_time: string
  max_capacity: number
  current_bookings: number
  school_id: string
  notes: string | null
  courses: { name: string; color: string; credit_cost: number; min_booking_notice_hours: number; language: string | null; notes: string | null } | null
  lesson_types: { code: string; name_en: string } | null
  teachers: { name: string } | null
  school_rooms: { name: string; school_locations: { name: string; address: string } | null } | null
  schools: { name: string; city: string; cancellation_policy_hours: number | null } | null
}

type BookingInfo = {
  booking_id: string
  credits_deducted: number
  access_source: string
}

type SchoolOption = {
  id: string
  name: string
  city: string
}

function hoursUntil(date: string, start_time: string): number {
  return (new Date(`${date}T${start_time}`).getTime() - Date.now()) / (1000 * 60 * 60)
}

// Cancel confirmation modal — reused on both pages
function CancelModal({
  lesson,
  bookingInfo,
  policyHours,
  onConfirm,
  onClose,
  cancelling,
}: {
  lesson: Lesson
  bookingInfo: BookingInfo
  policyHours: number
  onConfirm: () => void
  onClose: () => void
  cancelling: boolean
}) {
  const hours = hoursUntil(lesson.date, lesson.start_time)
  const willRefund = hours >= policyHours
  const credits = bookingInfo.credits_deducted

  const lessonDateStr = new Date(lesson.date + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
        <div className="px-6 pt-6 pb-4 space-y-4">
          <h3 className="font-semibold text-gray-900 text-lg">Cancel this lesson?</h3>

          <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Lesson</span>
              <span className="font-medium text-gray-900 text-right">{lesson.courses?.name ?? lesson.lesson_types?.name_en}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Date</span>
              <span className="font-medium text-gray-900">{lessonDateStr}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Time</span>
              <span className="font-medium text-gray-900">{lesson.start_time.slice(0, 5)} – {lesson.end_time.slice(0, 5)}</span>
            </div>
          </div>

          {credits > 0 && (
            willRefund ? (
              <div className="flex items-start gap-2.5 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                <span className="text-green-500 mt-0.5">✓</span>
                <p className="text-sm text-green-700">
                  <span className="font-semibold">{credits} credit{credits > 1 ? 's' : ''} will be refunded</span> — you are cancelling more than {policyHours}h before the lesson.
                </p>
              </div>
            ) : (
              <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <span className="text-red-500 mt-0.5">⚠️</span>
                <p className="text-sm text-red-700">
                  <span className="font-semibold">{credits} credit{credits > 1 ? 's' : ''} will be burned</span> — only {Math.max(0, hours).toFixed(1)}h remain, policy requires {policyHours}h notice.
                </p>
              </div>
            )
          )}
        </div>

        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={onConfirm}
            disabled={cancelling}
            className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition disabled:opacity-50 ${
              willRefund ? 'bg-gray-800 text-white hover:bg-gray-700' : 'bg-red-500 text-white hover:bg-red-600'
            }`}
          >
            {cancelling ? 'Cancelling...' : willRefund ? 'Yes, Cancel & Refund' : 'Yes, Cancel (burn credit)'}
          </button>
          <button onClick={onClose} disabled={cancelling}
            className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition">
            Go back
          </button>
        </div>
      </div>
    </div>
  )
}

export default function BookPage() {
  const supabase = createClient()
  const router = useRouter()
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [loading, setLoading] = useState(true)
  const [city, setCity] = useState('')
  const [userCity, setUserCity] = useState('')
  const [filterCountry, setFilterCountry] = useState('')
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>('')
  const [profileSchoolId, setProfileSchoolId] = useState<string | null>(null)
  const [schoolsInCity, setSchoolsInCity] = useState<SchoolOption[]>([])
  const [schoolsWithCredits, setSchoolsWithCredits] = useState<Set<string>>(new Set())
  const [hqCountries, setHqCountries] = useState<{ id: string; name: string; code: string }[]>([])
  const [hqCities, setHqCities] = useState<{ id: string; country_id: string; name: string }[]>([])

  // lesson_id → booking info for already-booked lessons
  const [bookedMap, setBookedMap] = useState<Record<string, BookingInfo>>({})

  const [booking, setBooking] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [bookingError, setBookingError] = useState<{ [lessonId: string]: string }>({})
  const [confirmLesson, setConfirmLesson] = useState<Lesson | null>(null)
  const [cancelTarget, setCancelTarget] = useState<{ lesson: Lesson; info: BookingInfo } | null>(null)
  const [filterLanguage, setFilterLanguage] = useState('')

  useEffect(() => {
    fetch('/api/locations')
      .then(r => r.json())
      .then(d => { setHqCountries(d.countries ?? []); setHqCities(d.cities ?? []) })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const [{ data: profile }, { data: student }] = await Promise.all([
        supabase.from('profiles').select('city').eq('id', user.id).single(),
        supabase.from('students').select('school_id, city, country').eq('user_id', user.id).single(),
      ])

      const c = profile?.city ?? student?.city ?? ''
      setUserCity(c)
      setCity(c)
      if (student?.country) setFilterCountry(student.country)

      const schoolId = student?.school_id ?? null
      setProfileSchoolId(schoolId)
      if (schoolId) setSelectedSchoolId(schoolId)

      const { data: pkgs } = await supabase
        .from('student_packages')
        .select('school_id')
        .eq('student_id', user.id)
        .eq('status', 'active')
        .gt('credits_remaining', 0)
        .gte('expires_at', new Date().toISOString())

      const { data: subs } = await supabase
        .from('student_subscriptions')
        .select('school_id')
        .eq('student_id', user.id)
        .eq('status', 'active')

      const ids = new Set<string>([
        ...((pkgs ?? []).map((p) => p.school_id)),
        ...((subs ?? []).map((s) => s.school_id)),
      ])
      setSchoolsWithCredits(ids)

      // Fetch upcoming confirmed bookings to know which lessons are already booked
      const { data: upcomingBookings } = await supabase
        .from('bookings')
        .select('id, lesson_id, credits_deducted, access_source')
        .eq('student_id', user.id)
        .eq('status', 'confirmed')

      const map: Record<string, BookingInfo> = {}
      for (const b of upcomingBookings ?? []) {
        map[b.lesson_id] = {
          booking_id: b.id,
          credits_deducted: b.credits_deducted,
          access_source: b.access_source,
        }
      }
      setBookedMap(map)
    }
    loadProfile()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    async function loadSchools() {
      if (!city) { setSchoolsInCity([]); return }
      const { data } = await supabase
        .from('schools')
        .select('id, name, city')
        .ilike('city', `%${city}%`)
        .eq('active', true)
        .order('name')
      setSchoolsInCity(data ?? [])
    }
    loadSchools()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city])

  const fetchLessons = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (selectedSchoolId) {
      params.set('school_id', selectedSchoolId)
    } else {
      if (city) params.set('city', city)
      if (filterCountry) params.set('country', filterCountry)
    }
    if (filterLanguage) params.set('language', filterLanguage)
    const res = await fetch(`/api/student/lessons?${params.toString()}`)
    if (res.ok) setLessons(await res.json())
    setLoading(false)
  }, [city, selectedSchoolId, filterLanguage, filterCountry])

  useEffect(() => { fetchLessons() }, [fetchLessons])

  async function confirmBook() {
    if (!confirmLesson) return
    const lessonId = confirmLesson.id
    setConfirmLesson(null)
    setBooking(lessonId)
    setBookingError(e => ({ ...e, [lessonId]: '' }))
    const res = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lesson_id: lessonId }),
    })
    const data = await res.json()
    if (!res.ok) {
      setBookingError(e => ({ ...e, [lessonId]: data.error ?? 'Booking failed' }))
      setBooking(null)
    } else {
      // Add to booked map immediately
      setBookedMap(m => ({
        ...m,
        [lessonId]: {
          booking_id: data.id,
          credits_deducted: confirmLesson.courses?.credit_cost ?? 1,
          access_source: data.access_source ?? 'package',
        },
      }))
      setLessons(prev => prev.map(l =>
        l.id === lessonId ? { ...l, current_bookings: l.current_bookings + 1 } : l
      ))
      setBooking(null)
    }
  }

  async function handleCancel() {
    if (!cancelTarget) return
    const { lesson, info } = cancelTarget
    setCancelling(info.booking_id)
    setCancelTarget(null)
    const res = await fetch(`/api/bookings/${info.booking_id}`, { method: 'DELETE' })
    if (res.ok) {
      setBookedMap(m => {
        const next = { ...m }
        delete next[lesson.id]
        return next
      })
      setLessons(prev => prev.map(l =>
        l.id === lesson.id ? { ...l, current_bookings: Math.max(0, l.current_bookings - 1) } : l
      ))
    }
    setCancelling(null)
  }

  const grouped: { [date: string]: Lesson[] } = {}
  for (const l of lessons) {
    if (!grouped[l.date]) grouped[l.date] = []
    grouped[l.date].push(l)
  }
  const sortedDates = Object.keys(grouped).sort()

  function formatDate(d: string) {
    return new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()
  }

  const creditCost = confirmLesson?.courses?.credit_cost ?? 1

  return (
    <div>
      {/* Confirm booking modal */}
      {confirmLesson && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="px-6 pt-6 pb-4">
              <h3 className="font-semibold text-gray-900 text-lg mb-1">Confirm Booking</h3>
              <p className="text-sm text-gray-500 mb-4">
                {confirmLesson.courses?.name ?? confirmLesson.lesson_types?.name_en}
              </p>
              <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Date</span>
                  <span className="font-medium text-gray-900">{new Date(confirmLesson.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Time</span>
                  <span className="font-medium text-gray-900">{confirmLesson.start_time.slice(0, 5)} – {confirmLesson.end_time.slice(0, 5)}</span>
                </div>
                {confirmLesson.teachers && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Teacher</span>
                    <span className="font-medium text-gray-900">{confirmLesson.teachers.name}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-500">School</span>
                  <span className="font-medium text-gray-900">{confirmLesson.schools?.name}</span>
                </div>
                <div className="border-t border-gray-200 pt-2 flex justify-between">
                  <span className="text-gray-500">Credits to deduct</span>
                  <span className="font-bold text-[#6B1F3A] text-base">{creditCost} credit{creditCost > 1 ? 's' : ''}</span>
                </div>
              </div>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button
                onClick={confirmBook}
                disabled={!!booking}
                className="flex-1 py-2.5 bg-[#6B1F3A] text-white rounded-xl text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
              >
                {booking ? 'Booking...' : 'Yes, Book Now'}
              </button>
              <button
                onClick={() => setConfirmLesson(null)}
                className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel modal */}
      {cancelTarget && (
        <CancelModal
          lesson={cancelTarget.lesson}
          bookingInfo={cancelTarget.info}
          policyHours={cancelTarget.lesson.schools?.cancellation_policy_hours ?? 24}
          onConfirm={handleCancel}
          onClose={() => setCancelTarget(null)}
          cancelling={!!cancelling}
        />
      )}

      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Book a Class</h1>
        <p className="text-gray-500 text-sm mt-0.5">Browse upcoming lessons in your city</p>
      </div>

      {/* Filters */}
      <div className="mb-5 flex flex-wrap gap-3 items-center">
        {/* Country filter */}
        {hqCountries.length > 0 ? (
          <select
            value={filterCountry}
            onChange={(e) => { setFilterCountry(e.target.value); setCity(''); setSelectedSchoolId('') }}
            className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 bg-white"
          >
            <option value="">All countries</option>
            {hqCountries.map((c) => (
              <option key={c.id} value={c.name}>{c.name}</option>
            ))}
          </select>
        ) : null}

        {/* City filter */}
        {hqCountries.length > 0 ? (() => {
          const matchedCountry = hqCountries.find((c) => c.name === filterCountry)
          const citiesForCountry = matchedCountry
            ? hqCities.filter((c) => c.country_id === matchedCountry.id)
            : []
          return (
            <select
              value={city}
              onChange={(e) => { setCity(e.target.value); setSelectedSchoolId('') }}
              disabled={!filterCountry || citiesForCountry.length === 0}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 bg-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {!filterCountry ? (
                <option value="">Select country first</option>
              ) : citiesForCountry.length === 0 ? (
                <option value="">No cities available</option>
              ) : (
                <>
                  <option value="">All cities</option>
                  {citiesForCountry.map((c) => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </>
              )}
            </select>
          )
        })() : (
          <input
            value={city}
            onChange={(e) => { setCity(e.target.value); setSelectedSchoolId('') }}
            placeholder="Filter by city..."
            className="px-3 py-2 rounded-lg border border-gray-200 text-sm w-44 focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
          />
        )}

        {/* School filter */}
        <select
          value={selectedSchoolId}
          onChange={(e) => setSelectedSchoolId(e.target.value)}
          disabled={!city || schoolsInCity.length === 0}
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 bg-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {!city ? (
            <option value="">Select city first</option>
          ) : schoolsInCity.length === 0 ? (
            <option value="">No schools found</option>
          ) : (
            <>
              <option value="">All schools</option>
              {schoolsInCity.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </>
          )}
        </select>

        {/* Language filter */}
        <select
          value={filterLanguage}
          onChange={(e) => setFilterLanguage(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
        >
          <option value="">All languages</option>
          {LANGUAGES.map((l) => (
            <option key={l.value} value={l.value}>{l.label}</option>
          ))}
        </select>

        {userCity && city !== userCity && (
          <button onClick={() => { setCity(userCity); setSelectedSchoolId(profileSchoolId ?? '') }} className="text-xs text-[#6B1F3A] hover:underline">
            Reset to my city
          </button>
        )}
        {(city || filterCountry) && (
          <button onClick={() => { setCity(''); setFilterCountry(''); setSelectedSchoolId('') }} className="text-xs text-gray-400 hover:text-gray-600">
            Clear filters
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-gray-400">Loading lessons...</div>
      ) : lessons.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
          <p className="text-gray-400 text-sm">No upcoming lessons found{city ? ` in ${city}` : ''}.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {sortedDates.map((date) => (
            <div key={date}>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{formatDate(date)}</p>
              <div className="space-y-3">
                {grouped[date].map((lesson) => {
                  const isFull = lesson.current_bookings >= lesson.max_capacity
                  const err = bookingError[lesson.id]
                  const spotsLeft = lesson.max_capacity - lesson.current_bookings
                  const hasCreditsHere = schoolsWithCredits.has(lesson.school_id)
                  const isProfileSchool = profileSchoolId === lesson.school_id
                  const bookedInfo = bookedMap[lesson.id]
                  const isBooked = !!bookedInfo
                  const isCancellingThis = cancelling === bookedInfo?.booking_id

                  // Policy hint for booked lessons
                  const policyHours = lesson.schools?.cancellation_policy_hours ?? 24
                  const hoursLeft = hoursUntil(lesson.date, lesson.start_time)
                  const willRefund = hoursLeft >= policyHours

                  const noCredits = !isBooked && !hasCreditsHere
                  const canBuyDirect = noCredits && isProfileSchool

                  return (
                    <div
                      key={lesson.id}
                      className={`bg-white rounded-xl border p-4 flex gap-4 items-start transition ${
                        isBooked
                          ? 'border-green-200 bg-green-50/30'
                          : 'border-gray-100'
                      } ${noCredits && !canBuyDirect ? 'opacity-75' : ''}`}
                    >
                      <div className="w-1 self-stretch rounded-full shrink-0" style={{ backgroundColor: lesson.courses?.color ?? '#6B1F3A' }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-semibold text-gray-900 text-sm">{lesson.courses?.name ?? lesson.lesson_types?.name_en}</p>
                              {isBooked && (
                                <span className="text-[10px] font-semibold text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full">✓ Booked</span>
                              )}
                            </div>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {lesson.lesson_types?.name_en}
                              {lesson.schools?.name && ` · ${lesson.schools.name}`}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-bold text-gray-900">{lesson.start_time.slice(0, 5)}</p>
                            <p className="text-xs text-gray-400">{lesson.end_time.slice(0, 5)}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 flex-wrap">
                          {lesson.teachers && <span>👤 {lesson.teachers.name}</span>}
                          {lesson.school_rooms && (
                            <span>📍 {lesson.school_rooms.school_locations?.name ?? ''} · {lesson.school_rooms.name}</span>
                          )}
                          <span>{lesson.courses?.credit_cost ?? 1} credit{(lesson.courses?.credit_cost ?? 1) > 1 ? 's' : ''}</span>
                          {lesson.courses?.language && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-gray-100 rounded text-gray-500">
                              {LANG_FLAG[lesson.courses.language] ?? ''} {LANGUAGES.find(l => l.value === lesson.courses!.language)?.label ?? lesson.courses.language}
                            </span>
                          )}
                        </div>
                        {(lesson.courses?.notes || lesson.notes) && (
                          <div className="mt-2 space-y-0.5">
                            {lesson.courses?.notes && <p className="text-xs text-gray-500">{lesson.courses.notes}</p>}
                            {lesson.notes && <p className="text-xs text-gray-500">{lesson.notes}</p>}
                          </div>
                        )}
                        {err && <p className="text-xs text-red-500 mt-2">{err}</p>}
                      </div>

                      <div className="shrink-0 flex flex-col items-end gap-1.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isFull && !isBooked ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                          {isFull && !isBooked ? 'Full' : `${spotsLeft} left`}
                        </span>

                        {isBooked ? (
                          <div className="flex flex-col items-end gap-1 mt-1">
                            {bookedInfo.credits_deducted > 0 && (
                              <span className={`text-[10px] font-medium ${willRefund ? 'text-green-600' : 'text-amber-600'}`}>
                                {willRefund ? '↩ refundable' : '⚠ will burn'}
                              </span>
                            )}
                            <button
                              onClick={() => setCancelTarget({ lesson, info: bookedInfo })}
                              disabled={isCancellingThis}
                              className="px-3 py-1.5 border border-red-200 text-red-500 rounded-lg text-xs font-medium hover:bg-red-50 transition disabled:opacity-40"
                            >
                              {isCancellingThis ? '...' : 'Cancel booking'}
                            </button>
                          </div>
                        ) : booking === lesson.id ? (
                          <span className="text-xs text-gray-400 mt-1">Booking...</span>
                        ) : canBuyDirect ? (
                          <button
                            onClick={() => router.push('/student/buy?redirect=/student/book')}
                            className="mt-1 px-4 py-1.5 bg-[#6B1F3A] text-white rounded-lg text-xs font-medium hover:bg-[#5a1930] transition"
                          >
                            Buy Credits
                          </button>
                        ) : noCredits ? (
                          <div className="relative group mt-1">
                            <button disabled className="px-4 py-1.5 bg-gray-200 text-gray-400 rounded-lg text-xs font-medium cursor-not-allowed">
                              Book
                            </button>
                            <div className="absolute right-0 bottom-full mb-2 w-64 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 leading-relaxed">
                              You don&apos;t have credits at {lesson.schools?.name ?? 'this school'}. First set this school in your profile, then purchase a credit package.
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => !isFull && setConfirmLesson(lesson)}
                            disabled={isFull || !!booking}
                            className="mt-1 px-4 py-1.5 bg-[#6B1F3A] text-white rounded-lg text-xs font-medium hover:bg-[#5a1930] disabled:opacity-40 transition"
                          >
                            Book
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
