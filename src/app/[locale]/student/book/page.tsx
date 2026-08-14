'use client'

import { useEffect, useState, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useTranslations, useLocale } from 'next-intl'
import { videoUrlForLocale, youtubeThumbnail, imageUrlForLocale } from '@/lib/video-preview'
import { lessonTypeName } from '@/lib/lesson-type-name'
import VideoPreviewPlayer from '@/components/ui/VideoPreviewPlayer'

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
  lesson_type_id: string | null
  teacher_id: string | null
  notes: string | null
  is_online: boolean
  online_link: string | null
  courses: { name: string; color: string; credit_cost: number; min_booking_notice_hours: number; language: string | null; notes: string | null; is_online: boolean; image_url: string | null } | null
  lesson_types: { id: string; code: string; name_en: string; name_it: string | null; name_fr: string | null; name_es: string | null; description_it: string | null; description_en: string | null; description_fr: string | null; description_es: string | null; image_url: string | null; image_url_it: string | null; image_url_en: string | null; image_url_fr: string | null; image_url_es: string | null; video_url_it: string | null; video_url_en: string | null; video_url_fr: string | null; video_url_es: string | null } | null
  teachers: { id: string; name: string; photo_url: string | null } | null
  school_rooms: { name: string; school_locations: { name: string; address: string | null; google_maps_url: string | null } | null } | null
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
  const t = useTranslations('student.book')
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
          <h3 className="font-semibold text-gray-900 text-lg">{t('cancelModalTitle')}</h3>

          <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">{t('lessonLabel')}</span>
              <span className="font-medium text-gray-900 text-right">{lesson.courses?.name ?? lesson.lesson_types?.name_en}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">{t('dateLabel')}</span>
              <span className="font-medium text-gray-900">{lessonDateStr}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">{t('timeLabel')}</span>
              <span className="font-medium text-gray-900">{lesson.start_time.slice(0, 5)} – {lesson.end_time.slice(0, 5)}</span>
            </div>
          </div>

          {credits > 0 && (
            willRefund ? (
              <div className="flex items-start gap-2.5 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                <span className="text-green-500 mt-0.5">✓</span>
                <p className="text-sm text-green-700">
                  <span className="font-semibold">{t('creditsWillBeRefunded', { count: credits })}</span>{t('cancelBeforePolicy', { policyHours })}
                </p>
              </div>
            ) : (
              <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <span className="text-red-500 mt-0.5">⚠️</span>
                <p className="text-sm text-red-700">
                  <span className="font-semibold">{t('creditsWillBeBurned', { count: credits })}</span>{t('cancelAfterPolicy', { hoursLeft: Math.max(0, hours).toFixed(1), policyHours })}
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
            {cancelling ? t('cancellingText') : willRefund ? t('yesCancelRefund') : t('yesCancelBurn')}
          </button>
          <button onClick={onClose} disabled={cancelling}
            className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition">
            {t('goBack')}
          </button>
        </div>
      </div>
    </div>
  )
}

function BookPageInner() {
  const t = useTranslations('student.book')
  const locale = useLocale()
  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [loading, setLoading] = useState(true)
  const [city, setCity] = useState('')
  const [userCity, setUserCity] = useState('')
  const [filterCountry, setFilterCountry] = useState('')
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>('')
  const [profileSchoolId, setProfileSchoolId] = useState<string | null>(null)
  const [schoolsInCity, setSchoolsInCity] = useState<SchoolOption[]>([])
  const [schoolCredits, setSchoolCredits] = useState<Map<string, number>>(new Map())
  const [hqCountries, setHqCountries] = useState<{ id: string; name: string; code: string }[]>([])
  const [hqCities, setHqCities] = useState<{ id: string; country_id: string; name: string }[]>([])

  const [bookedMap, setBookedMap] = useState<Record<string, BookingInfo>>({})

  const [booking, setBooking] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [bookingError, setBookingError] = useState<{ [lessonId: string]: string }>({})
  const [confirmLesson, setConfirmLesson] = useState<Lesson | null>(null)
  const [detailLesson, setDetailLesson] = useState<Lesson | null>(null)
  const [view, setView] = useState<'list' | 'calendar'>('list')
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` })
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [cancelTarget, setCancelTarget] = useState<{ lesson: Lesson; info: BookingInfo } | null>(null)
  const [filterLanguage, setFilterLanguage] = useState('')
  const [filterLessonTypeId, setFilterLessonTypeId] = useState('')
  const [filterTeacherId, setFilterTeacherId] = useState('')
  const [filterOnline, setFilterOnline] = useState('')

  useEffect(() => {
    fetch('/api/locations', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { setHqCountries(d.countries ?? []); setHqCities(d.cities ?? []) })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const paymentSuccess = searchParams.get('payment') === 'success'

  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const [{ data: profile }, { data: student }] = await Promise.all([
        supabase.from('profiles').select('city').eq('id', user.id).single(),
        supabase.from('students').select('id, school_id, city, country').eq('user_id', user.id).single(),
      ])

      const c = profile?.city ?? student?.city ?? ''
      setUserCity(c)
      setCity(c)
      if (student?.country) setFilterCountry(student.country)

      const schoolId = student?.school_id ?? null
      setProfileSchoolId(schoolId)
      if (schoolId) setSelectedSchoolId(schoolId)

      const [pkgsRes, subsRes, bookingsRes] = await Promise.all([
        fetch('/api/student/packages', { cache: 'no-store' }),
        fetch('/api/student/subscriptions', { cache: 'no-store' }),
        fetch('/api/student/bookings', { cache: 'no-store' }),
      ])
      const allPkgs: { school_id: string; credits_remaining: number; status: string; expires_at: string }[] =
        pkgsRes.ok ? await pkgsRes.json() : []
      const allSubs: { school_id: string; status: string }[] =
        subsRes.ok ? await subsRes.json() : []
      const upcomingBookings: { id: string; lesson_id: string; credits_deducted: number; access_source: string }[] =
        bookingsRes.ok ? await bookingsRes.json() : []

      const pkgs = allPkgs.filter(
        (p) => p.status === 'active' && p.credits_remaining > 0 && new Date(p.expires_at) > new Date()
      )
      const subs = allSubs.filter((s) => s.status === 'active')

      const creditsMap = new Map<string, number>()
      for (const p of pkgs) {
        creditsMap.set(p.school_id, (creditsMap.get(p.school_id) ?? 0) + p.credits_remaining)
      }
      for (const s of subs) {
        creditsMap.set(s.school_id, 99999)
      }
      setSchoolCredits(creditsMap)

      const map: Record<string, BookingInfo> = {}
      for (const b of upcomingBookings) {
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
  }, [paymentSuccess])

  useEffect(() => {
    async function loadSchools() {
      if (!city) { setSchoolsInCity([]); return }
      const res = await fetch('/api/schools/public', { cache: 'no-store' })
      if (!res.ok) return
      const all: { id: string; name: string; city: string }[] = await res.json()
      setSchoolsInCity(all.filter(s => s.city?.toLowerCase().includes(city.toLowerCase())))
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
      // Only filter by city/country if user explicitly selected a country
      if (filterCountry) {
        params.set('country', filterCountry)
        if (city) params.set('city', city)
      }
    }
    if (filterLanguage) params.set('language', filterLanguage)
    if (filterLessonTypeId) params.set('lesson_type_id', filterLessonTypeId)
    if (filterTeacherId) params.set('teacher_id', filterTeacherId)
    if (filterOnline) params.set('is_online', filterOnline)
    const res = await fetch(`/api/student/lessons?${params.toString()}`)
    if (res.ok) setLessons(await res.json())
    setLoading(false)
  }, [city, selectedSchoolId, filterLanguage, filterCountry, filterLessonTypeId, filterTeacherId, filterOnline])

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
      setBookingError(e => ({ ...e, [lessonId]: data.error ?? t('bookingFailed') }))
      setBooking(null)
    } else {
      const creditCostUsed = confirmLesson.courses?.credit_cost ?? 1
      setBookedMap(m => ({
        ...m,
        [lessonId]: {
          booking_id: data.id,
          credits_deducted: creditCostUsed,
          access_source: data.access_source ?? 'package',
        },
      }))
      setLessons(prev => prev.map(l =>
        l.id === lessonId ? { ...l, current_bookings: l.current_bookings + 1 } : l
      ))
      // Update local credits map immediately
      setSchoolCredits(prev => {
        const next = new Map(prev)
        const schoolId = confirmLesson.school_id
        next.set(schoolId, Math.max(0, (next.get(schoolId) ?? 0) - creditCostUsed))
        return next
      })
      window.dispatchEvent(new Event('credits-changed'))
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
      const resData = await res.json()
      setBookedMap(m => {
        const next = { ...m }
        delete next[lesson.id]
        return next
      })
      setLessons(prev => prev.map(l =>
        l.id === lesson.id ? { ...l, current_bookings: Math.max(0, l.current_bookings - 1) } : l
      ))
      // Refund credits locally if within policy
      if (resData.refunded && info.credits_deducted > 0) {
        setSchoolCredits(prev => {
          const next = new Map(prev)
          const schoolId = lesson.school_id
          next.set(schoolId, (next.get(schoolId) ?? 0) + info.credits_deducted)
          return next
        })
      }
      window.dispatchEvent(new Event('credits-changed'))
    }
    setCancelling(null)
  }

  const uniqueLessonTypes = Array.from(
    new Map(lessons.filter(l => l.lesson_type_id && l.lesson_types).map(l => [l.lesson_type_id!, { ...l.lesson_types!, id: l.lesson_type_id! }])).values()
  )
  const uniqueTeachers = Array.from(
    new Map(lessons.filter(l => l.teacher_id && l.teachers).map(l => [l.teacher_id!, { ...l.teachers!, id: l.teacher_id! }])).values()
  )

  const grouped: { [date: string]: Lesson[] } = {}
  for (const l of lessons) {
    if (!grouped[l.date]) grouped[l.date] = []
    grouped[l.date].push(l)
  }
  const sortedDates = Object.keys(grouped).sort()
  const visibleDates = view === 'calendar' ? sortedDates.filter(d => d === selectedDay) : sortedDates

  function formatDate(d: string) {
    return new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()
  }

  const creditCost = confirmLesson?.courses?.credit_cost ?? 1
  const confirmHasCredits = confirmLesson
    ? (schoolCredits.get(confirmLesson.school_id) ?? 0) >= creditCost
    : false

  return (
    <div>
      {/* Confirm booking modal */}
      {confirmLesson && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="px-6 pt-6 pb-4">
              <h3 className="font-semibold text-gray-900 text-lg mb-1">{t('confirmBookingTitle')}</h3>
              <p className="text-sm text-gray-500 mb-4">
                {confirmLesson.courses?.name ?? confirmLesson.lesson_types?.name_en}
              </p>
              <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">{t('dateLabel')}</span>
                  <span className="font-medium text-gray-900">{new Date(confirmLesson.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">{t('timeLabel')}</span>
                  <span className="font-medium text-gray-900">{confirmLesson.start_time.slice(0, 5)} – {confirmLesson.end_time.slice(0, 5)}</span>
                </div>
                {confirmLesson.teachers && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">{t('teacherLabel')}</span>
                    <span className="font-medium text-gray-900">{confirmLesson.teachers.name}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-500">{t('schoolLabel')}</span>
                  <span className="font-medium text-gray-900">{confirmLesson.schools?.name}</span>
                </div>
                <div className="border-t border-gray-200 pt-2 flex justify-between">
                  <span className="text-gray-500">{t('creditsToDeduct')}</span>
                  <span className="font-bold text-[#6B1F3A] text-base">{creditCost} credit{creditCost > 1 ? 's' : ''}</span>
                </div>
              </div>
              {!confirmHasCredits && (
                <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
                  {t('notEnoughCredits')}
                </div>
              )}
            </div>
            <div className="px-6 pb-6 flex gap-3">
              {confirmHasCredits ? (
                <button
                  onClick={confirmBook}
                  disabled={!!booking}
                  className="flex-1 py-2.5 bg-[#6B1F3A] text-white rounded-xl text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
                >
                  {booking ? t('bookingInProgress') : t('yesBookNow')}
                </button>
              ) : (
                <button
                  onClick={() => {
                    setConfirmLesson(null)
                    router.push('/student/buy?redirect=/student/book')
                  }}
                  className="flex-1 py-2.5 bg-[#6B1F3A] text-white rounded-xl text-sm font-medium hover:bg-[#5a1930] transition"
                >
                  {t('buyCreditsButton')}
                </button>
              )}
              <button
                onClick={() => setConfirmLesson(null)}
                className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition"
              >
                {t('cancelButton')}
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
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-gray-500 text-sm mt-0.5">{t('subtitle')}</p>
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
            <option value="">{t('allCountries')}</option>
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
                <option value="">{t('selectCountryFirst')}</option>
              ) : citiesForCountry.length === 0 ? (
                <option value="">{t('noCitiesAvailable')}</option>
              ) : (
                <>
                  <option value="">{t('allCities')}</option>
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
            placeholder={t('filterByCity')}
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
            <option value="">{t('selectCityFirst')}</option>
          ) : schoolsInCity.length === 0 ? (
            <option value="">{t('noSchoolsFound')}</option>
          ) : (
            <>
              <option value="">{t('allSchools')}</option>
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
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 bg-white"
        >
          <option value="">{t('allLanguages')}</option>
          {LANGUAGES.map((l) => (
            <option key={l.value} value={l.value}>{l.label}</option>
          ))}
        </select>

        {/* Type of class filter */}
        <select
          value={filterLessonTypeId}
          onChange={(e) => setFilterLessonTypeId(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 bg-white"
        >
          <option value="">{t('allTypes')}</option>
          {uniqueLessonTypes.map((lt) => (
            <option key={lt.id} value={lt.id}>{lt.name_en}</option>
          ))}
        </select>

        {/* Teacher filter */}
        <select
          value={filterTeacherId}
          onChange={(e) => setFilterTeacherId(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 bg-white"
        >
          <option value="">{t('allTeachers')}</option>
          {uniqueTeachers.map((teacher) => (
            <option key={teacher.id} value={teacher.id}>{teacher.name}</option>
          ))}
        </select>

        {/* Online / In-Person filter */}
        <select
          value={filterOnline}
          onChange={(e) => setFilterOnline(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 bg-white"
        >
          <option value="">All Formats</option>
          <option value="true">🌐 Online</option>
          <option value="false">📍 In-Person</option>
        </select>

        {userCity && city !== userCity && (
          <button onClick={() => { setCity(userCity); setSelectedSchoolId(profileSchoolId ?? '') }} className="text-xs text-[#6B1F3A] hover:underline">
            {t('resetToMyCity')}
          </button>
        )}
        {(city || filterCountry || filterLanguage || filterLessonTypeId || filterTeacherId || filterOnline) && (
          <button onClick={() => { setCity(''); setFilterCountry(''); setSelectedSchoolId(''); setFilterLanguage(''); setFilterLessonTypeId(''); setFilterTeacherId(''); setFilterOnline('') }} className="text-xs text-gray-400 hover:text-gray-600">
            {t('clearFilters')}
          </button>
        )}
      </div>

      <>
      {/* Toggle vista elenco/calendario */}
      <div className="inline-flex bg-gray-100 rounded-xl p-1 mb-4">
        <button onClick={() => setView('list')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${view === 'list' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>
          {t('viewList')}
        </button>
        <button onClick={() => setView('calendar')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${view === 'calendar' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>
          {t('viewCalendar')}
        </button>
      </div>

      {view === 'calendar' && !loading && (
        <BookingCalendar
          lessons={lessons}
          month={calMonth}
          onMonthChange={setCalMonth}
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
        />
      )}

      {loading ? (
        <div className="text-sm text-gray-400">{t('loadingLessons')}</div>
      ) : lessons.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
          <p className="text-gray-400 text-sm">{city ? t('noLessonsFoundIn', { city }) : t('noLessonsFound')}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {visibleDates.map((date) => (
            <div key={date}>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{formatDate(date)}</p>
              <div className="space-y-3">
                {grouped[date].map((lesson) => {
                  const isFull = lesson.current_bookings >= lesson.max_capacity
                  const err = bookingError[lesson.id]
                  const spotsLeft = lesson.max_capacity - lesson.current_bookings
                  const hasCreditsHere = (schoolCredits.get(lesson.school_id) ?? 0) >= (lesson.courses?.credit_cost ?? 1)
                  const isProfileSchool = profileSchoolId === lesson.school_id
                  const bookedInfo = bookedMap[lesson.id]
                  const isBooked = !!bookedInfo
                  const isCancellingThis = cancelling === bookedInfo?.booking_id

                  const policyHours = lesson.schools?.cancellation_policy_hours ?? 24
                  const hoursLeft = hoursUntil(lesson.date, lesson.start_time)
                  const willRefund = hoursLeft >= policyHours

                  return (
                    <div
                      key={lesson.id}
                      className={`bg-white rounded-xl border p-4 flex gap-4 items-start transition ${
                        isBooked ? 'border-green-200 bg-green-50/30' : 'border-gray-100'
                      }`}
                    >
                      <div className="w-1 self-stretch rounded-full shrink-0" style={{ backgroundColor: lesson.courses?.color ?? '#6B1F3A' }} />
                      {(() => {
                        const video = videoUrlForLocale(lesson.lesson_types, locale)
                        const img = imageUrlForLocale(lesson.lesson_types, locale) ?? lesson.courses?.image_url ?? youtubeThumbnail(video)
                        return (
                          <button type="button" onClick={(e) => { e.stopPropagation(); setDetailLesson(lesson) }}
                            className="relative shrink-0 hidden sm:block group" title={t('videoPreview')}>
                            {img ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={img} alt="" className="w-16 h-16 object-cover rounded-lg" />
                            ) : (
                              <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center text-gray-300">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                                </svg>
                              </div>
                            )}
                            <span className="absolute bottom-1 right-1 w-5 h-5 rounded-full bg-black/50 flex items-center justify-center group-hover:bg-black/70 transition">
                              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                              </svg>
                            </span>
                          </button>
                        )
                      })()}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-semibold text-gray-900 text-sm">{lesson.courses?.name ?? lesson.lesson_types?.name_en}</p>
                              {isBooked && (
                                <span className="text-[10px] font-semibold text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full">{t('booked')}</span>
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
                          {lesson.is_online ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-teal-50 text-teal-700 rounded font-medium">🌐 Online</span>
                          ) : (
                            lesson.school_rooms && (
                              <span>📍 {lesson.school_rooms.school_locations?.name ?? ''} · {lesson.school_rooms.name}</span>
                            )
                          )}
                          {lesson.teachers && <span>👤 {lesson.teachers.name}</span>}
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
                          {isFull && !isBooked ? t('full') : t('spotsLeft', { count: spotsLeft })}
                        </span>

                        {isBooked ? (
                          <div className="flex flex-col items-end gap-1 mt-1">
                            {lesson.is_online && lesson.online_link && (
                              <a
                                href={lesson.online_link.startsWith('http') ? lesson.online_link : `https://${lesson.online_link}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-3 py-1.5 bg-teal-600 text-white rounded-lg text-xs font-medium hover:bg-teal-700 transition"
                              >
                                🌐 Join
                              </a>
                            )}
                            {bookedInfo.credits_deducted > 0 && (
                              <span className={`text-[10px] font-medium ${willRefund ? 'text-green-600' : 'text-amber-600'}`}>
                                {willRefund ? t('refundable') : t('willBurn')}
                              </span>
                            )}
                            <button
                              onClick={() => setCancelTarget({ lesson, info: bookedInfo })}
                              disabled={isCancellingThis}
                              className="px-3 py-1.5 border border-red-200 text-red-500 rounded-lg text-xs font-medium hover:bg-red-50 transition disabled:opacity-40"
                            >
                              {isCancellingThis ? '...' : t('cancelBooking')}
                            </button>
                          </div>
                        ) : booking === lesson.id ? (
                          <span className="text-xs text-gray-400 mt-1">{t('bookingInProgress')}</span>
                        ) : (
                          <button
                            onClick={() => {
                              if (isFull) return
                              setConfirmLesson(lesson)
                            }}
                            disabled={isFull || !!booking}
                            className="mt-1 px-4 py-1.5 rounded-lg text-xs font-medium transition bg-[#6B1F3A] text-white hover:bg-[#5a1930] disabled:opacity-40"
                          >
                            {t('bookButton')}
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
      )}</>

      {/* Dettaglio corso: descrizione, video, sede e mappa */}
      {detailLesson && (
        <LessonDetailModal lesson={detailLesson} locale={locale} onClose={() => setDetailLesson(null)} />
      )}
    </div>
  )
}

export default function BookPage() {
  return (
    <Suspense>
      <BookPageInner />
    </Suspense>
  )
}


// Modal dettaglio lezione: media (se presenti) + descrizione + sede con Google Maps
function LessonDetailModal({ lesson, locale, onClose }: { lesson: Lesson; locale: string; onClose: () => void }) {
  const t = useTranslations('student.book')
  const lt = lesson.lesson_types
  const video = videoUrlForLocale(lt, locale)
  const img = imageUrlForLocale(lt, locale) ?? lesson.courses?.image_url ?? youtubeThumbnail(video)
  const desc = lt ? ({ it: lt.description_it, en: lt.description_en, fr: lt.description_fr, es: lt.description_es } as Record<string, string | null>)[locale] ?? lt.description_en : null
  const loc = lesson.school_rooms?.school_locations
  const mapsUrl = loc?.google_maps_url || (loc?.address ? `https://maps.google.com/?q=${encodeURIComponent(loc.address)}` : null)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <VideoPreviewPlayer video={video} image={img} />
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-semibold text-gray-900 text-lg">
              {lesson.courses?.name?.trim() || lessonTypeName(lt, locale)}
            </h3>
            <button onClick={onClose} className="text-gray-300 hover:text-gray-500 text-xl leading-none">×</button>
          </div>
          {desc && <p className="text-sm text-gray-500 mt-2 whitespace-pre-line">{desc}</p>}

          {/* Insegnante: foto (o avatar con iniziali) + nome */}
          {lesson.teachers && (
            <div className="mt-4 flex items-center gap-3">
              {lesson.teachers.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={lesson.teachers.photo_url} alt={lesson.teachers.name} className="w-10 h-10 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-[#6B1F3A]/10 text-[#6B1F3A] flex items-center justify-center text-sm font-semibold shrink-0">
                  {lesson.teachers.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{lesson.teachers.name}</p>
                <p className="text-xs text-gray-400">{t('teacherLabel')}</p>
              </div>
            </div>
          )}

          {/* Sede: indirizzo completo + Google Maps */}
          {(loc || lesson.is_online) && (
            <div className="mt-4 bg-gray-50 rounded-xl p-3">
              {lesson.is_online ? (
                <p className="text-sm text-gray-600">🌐 {t('onlineLesson')}</p>
              ) : (
                <>
                  <p className="text-sm font-medium text-gray-800">📍 {loc?.name}{lesson.school_rooms?.name ? ` — ${lesson.school_rooms.name}` : ''}</p>
                  {loc?.address && <p className="text-xs text-gray-500 mt-0.5">{loc.address}</p>}
                  {mapsUrl && (
                    <a href={mapsUrl} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 mt-2 text-sm text-[#6B1F3A] font-medium hover:underline">
                      {t('openInMaps')} ↗
                    </a>
                  )}
                </>
              )}
            </div>
          )}

          {video && (
            <a href={video} target="_blank" rel="noreferrer" className="inline-block mt-3 text-sm text-[#6B1F3A] font-medium hover:underline">
              {t('videoPreview')} ↗
            </a>
          )}
        </div>
      </div>
    </div>
  )
}


// Griglia mensile: giorni con lezioni evidenziati, click → elenco del giorno
function BookingCalendar({ lessons, month, onMonthChange, selectedDay, onSelectDay }: {
  lessons: Lesson[]
  month: string // 'YYYY-MM'
  onMonthChange: (m: string) => void
  selectedDay: string | null
  onSelectDay: (d: string | null) => void
}) {
  const t = useTranslations('student.book')
  const [y, m] = month.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const startOffset = (first.getDay() + 6) % 7 // lunedì = 0
  const daysInMonth = new Date(y, m, 0).getDate()
  const cells = Math.ceil((startOffset + daysInMonth) / 7) * 7

  const byDay = new Map<string, Lesson[]>()
  for (const l of lessons) {
    if (!byDay.has(l.date)) byDay.set(l.date, [])
    byDay.get(l.date)!.push(l)
  }

  function shift(delta: number) {
    const d = new Date(y, m - 1 + delta, 1)
    onMonthChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    onSelectDay(null)
  }

  const monthLabel = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const dayNames = [1, 2, 3, 4, 5, 6, 0].map(d => new Date(2026, 5, d + 1).toLocaleDateString(undefined, { weekday: 'short' }))
  const today = new Date().toISOString().split('T')[0]

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3 mb-6 max-w-sm">
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => shift(-1)} className="w-7 h-7 rounded-lg hover:bg-gray-50 text-gray-400">‹</button>
        <p className="text-sm font-semibold text-gray-900 capitalize">{monthLabel}</p>
        <button onClick={() => shift(1)} className="w-7 h-7 rounded-lg hover:bg-gray-50 text-gray-400">›</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-gray-400 uppercase mb-1">
        {dayNames.map((d, i) => <div key={i}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: cells }, (_, i) => {
          const dayNum = i - startOffset + 1
          if (dayNum < 1 || dayNum > daysInMonth) return <div key={i} />
          const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`
          const dayLessons = byDay.get(dateStr) ?? []
          const isSelected = selectedDay === dateStr
          const isPast = dateStr < today
          return (
            <button
              key={i}
              onClick={() => dayLessons.length ? onSelectDay(isSelected ? null : dateStr) : undefined}
              className={`aspect-square rounded-lg text-xs flex flex-col items-center justify-center gap-0.5 transition ${
                isSelected ? 'bg-[#6B1F3A] text-white'
                : dayLessons.length ? 'bg-[#6B1F3A]/5 hover:bg-[#6B1F3A]/10 text-gray-900 cursor-pointer'
                : 'text-gray-300'
              } ${isPast && !isSelected ? 'opacity-40' : ''}`}
            >
              <span>{dayNum}</span>
              {dayLessons.length > 0 && (
                <span className="flex gap-0.5">
                  {dayLessons.slice(0, 3).map((l, j) => (
                    <span key={j} className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white' : ''}`}
                      style={isSelected ? {} : { backgroundColor: l.courses?.color ?? '#6B1F3A' }} />
                  ))}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {!selectedDay && <p className="text-xs text-gray-400 mt-3 text-center">{t('calendarHint')}</p>}
    </div>
  )
}
