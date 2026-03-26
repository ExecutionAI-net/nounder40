'use client'

import { useEffect, useState } from 'react'

type Booking = {
  id: string
  status: string
  credits_deducted: number
  access_source: string
  credit_refunded: boolean
  cancelled_at: string | null
  lessons: {
    id: string
    date: string
    start_time: string
    end_time: string
    courses: { name: string; color: string } | null
    lesson_types: { name_en: string } | null
    teachers: { name: string } | null
    school_rooms: { name: string; school_locations: { name: string } | null } | null
  } | null
  schools: { name: string; city: string } | null
}

type Tab = 'upcoming' | 'past' | 'cancelled'

export default function MyBookingsPage() {
  const [tab, setTab] = useState<Tab>('upcoming')
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [cancelResult, setCancelResult] = useState<{ [id: string]: string }>({})

  async function load(t: Tab) {
    setLoading(true)
    const res = await fetch(`/api/bookings?status=${t}`)
    if (res.ok) setBookings(await res.json())
    setLoading(false)
  }

  useEffect(() => { load(tab) }, [tab])

  async function handleCancel(booking: Booking) {
    setCancelling(booking.id)
    const res = await fetch(`/api/bookings/${booking.id}`, { method: 'DELETE' })
    const data = await res.json()
    if (res.ok) {
      setCancelResult(r => ({
        ...r,
        [booking.id]: data.refunded
          ? `Cancelled. ${booking.credits_deducted} credit(s) refunded.`
          : `Cancelled. Credit burned (outside ${data.policy_hours}h policy).`,
      }))
      load(tab)
    } else {
      setCancelResult(r => ({ ...r, [booking.id]: data.error ?? 'Failed' }))
    }
    setCancelling(null)
  }

  function formatDate(d: string) {
    return new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'past', label: 'Past' },
    { key: 'cancelled', label: 'Cancelled' },
  ]

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">My Lessons</h1>
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-5 w-fit">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-gray-400">Loading...</div>
      ) : bookings.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
          <p className="text-gray-400 text-sm">No {tab} lessons.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map((b) => {
            const lesson = b.lessons
            if (!lesson) return null
            const isUpcoming = tab === 'upcoming'
            const lessonDate = new Date(lesson.date + 'T12:00:00')
            const isPast = lessonDate < new Date()

            return (
              <div key={b.id} className="bg-white rounded-xl border border-gray-100 p-4 flex gap-4 items-start">
                <div className="w-1 self-stretch rounded-full flex-shrink-0" style={{ backgroundColor: lesson.courses?.color ?? '#6B1F3A' }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-gray-900 text-sm">{lesson.courses?.name ?? lesson.lesson_types?.name_en}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{b.schools?.name} · {b.schools?.city}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-gray-900">{formatDate(lesson.date)}</p>
                      <p className="text-xs text-gray-400">{lesson.start_time.slice(0, 5)} – {lesson.end_time.slice(0, 5)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                    {lesson.teachers && <span>👤 {lesson.teachers.name}</span>}
                    {lesson.school_rooms && (
                      <span>📍 {lesson.school_rooms.school_locations?.name ?? ''} · {lesson.school_rooms.name}</span>
                    )}
                    <span className="capitalize">{b.access_source.replace('_', ' ')}</span>
                  </div>
                  {cancelResult[b.id] && (
                    <p className="text-xs text-blue-600 mt-2">{cancelResult[b.id]}</p>
                  )}
                  {b.status === 'cancelled' && (
                    <p className="text-xs text-gray-400 mt-1">
                      {b.credit_refunded ? '✓ Credit refunded' : '✗ Credit burned'}
                    </p>
                  )}
                </div>
                {isUpcoming && !isPast && (
                  <button
                    onClick={() => handleCancel(b)}
                    disabled={cancelling === b.id}
                    className="flex-shrink-0 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-500 hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition disabled:opacity-40"
                  >
                    {cancelling === b.id ? '...' : 'Cancel'}
                  </button>
                )}
                {tab === 'past' && (
                  <span className={`flex-shrink-0 text-xs px-2 py-1 rounded-full font-medium ${b.status === 'attended' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-500'}`}>
                    {b.status === 'attended' ? 'Attended' : 'No-show'}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
