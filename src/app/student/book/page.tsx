'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type Lesson = {
  id: string
  date: string
  start_time: string
  end_time: string
  max_capacity: number
  current_bookings: number
  school_id: string
  courses: { name: string; color: string; credit_cost: number; min_booking_notice_hours: number } | null
  lesson_types: { code: string; name_en: string } | null
  teachers: { name: string } | null
  school_rooms: { name: string; school_locations: { name: string; address: string } | null } | null
  schools: { name: string; city: string } | null
}

export default function BookPage() {
  const supabase = createClient()
  const router = useRouter()
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [loading, setLoading] = useState(true)
  const [city, setCity] = useState('')
  const [userCity, setUserCity] = useState('')
  const [booking, setBooking] = useState<string | null>(null)
  const [bookingError, setBookingError] = useState<{ [lessonId: string]: string }>({})
  const [confirmLesson, setConfirmLesson] = useState<Lesson | null>(null)
  const [studentSchoolId, setStudentSchoolId] = useState<string | null>(null)

  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: profile } = await supabase.from('profiles').select('city').eq('id', user.id).single()
      const c = profile?.city ?? ''
      setUserCity(c)
      setCity(c)
      const { data: student } = await supabase.from('students').select('school_id').eq('user_id', user.id).single()
      setStudentSchoolId(student?.school_id ?? null)
    }
    loadProfile()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchLessons = useCallback(async () => {
    setLoading(true)
    const params = city ? `?city=${encodeURIComponent(city)}` : ''
    const res = await fetch(`/api/student/lessons${params}`)
    if (res.ok) setLessons(await res.json())
    setLoading(false)
  }, [city])

  useEffect(() => {
    if (city !== undefined) fetchLessons()
  }, [fetchLessons, city])

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
      router.push('/student/bookings')
    }
  }

  // Group lessons by date
  const grouped: { [date: string]: Lesson[] } = {}
  for (const l of lessons) {
    if (!grouped[l.date]) grouped[l.date] = []
    grouped[l.date].push(l)
  }
  const sortedDates = Object.keys(grouped).sort()

  function formatDate(d: string) {
    return new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
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
                  <span className="font-medium text-gray-900">{formatDate(confirmLesson.date)}</span>
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
                disabled={booking === confirmLesson.id}
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
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Book a Class</h1>
        <p className="text-gray-500 text-sm mt-0.5">Browse upcoming lessons in your city</p>
      </div>

      {/* City filter */}
      <div className="mb-5 flex gap-3">
        <input
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder="Filter by city..."
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
        />
        {userCity && city !== userCity && (
          <button onClick={() => setCity(userCity)} className="text-xs text-[#6B1F3A] hover:underline">
            Reset to my city ({userCity})
          </button>
        )}
        {city && (
          <button onClick={() => setCity('')} className="text-xs text-gray-400 hover:text-gray-600">
            Show all cities
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
                  const isOtherSchool = studentSchoolId !== null && lesson.school_id !== studentSchoolId

                  return (
                    <div key={lesson.id} className="bg-white rounded-xl border border-gray-100 p-4 flex gap-4 items-start">
                      <div className="w-1 self-stretch rounded-full flex-shrink-0" style={{ backgroundColor: lesson.courses?.color ?? '#6B1F3A' }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold text-gray-900 text-sm">{lesson.courses?.name ?? lesson.lesson_types?.name_en}</p>
                            <p className="text-xs text-gray-400 mt-0.5">{lesson.lesson_types?.name_en} · {lesson.schools?.name}</p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-sm font-bold text-gray-900">{lesson.start_time.slice(0, 5)}</p>
                            <p className="text-xs text-gray-400">{lesson.end_time.slice(0, 5)}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                          {lesson.teachers && <span>👤 {lesson.teachers.name}</span>}
                          {lesson.school_rooms && (
                            <span>📍 {lesson.school_rooms.school_locations?.name ?? ''} · {lesson.school_rooms.name}</span>
                          )}
                          <span>{lesson.courses?.credit_cost ?? 1} credit{(lesson.courses?.credit_cost ?? 1) > 1 ? 's' : ''}</span>
                        </div>
                        {err && <p className="text-xs text-red-500 mt-2">{err}</p>}
                      </div>
                      <div className="flex-shrink-0 flex flex-col items-end gap-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isFull ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                          {isFull ? 'Full' : `${spotsLeft} left`}
                        </span>
                        {booking === lesson.id ? (
                          <span className="text-xs text-gray-400 mt-1">Booking...</span>
                        ) : bookingError[lesson.id] ? null : isOtherSchool ? (
                          <div className="relative group mt-1">
                            <button
                              disabled
                              className="px-4 py-1.5 bg-gray-200 text-gray-400 rounded-lg text-xs font-medium cursor-not-allowed"
                            >
                              Book
                            </button>
                            <div className="absolute right-0 bottom-full mb-2 w-60 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 leading-relaxed">
                              You can only book lessons from your enrolled school. To book from this school, update your school in your profile.
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmLesson(lesson)}
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
