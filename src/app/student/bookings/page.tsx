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
    if (res.ok) {
      const data: Booking[] = await res.json()
      data.sort((a, b) => {
        const da = a.lessons?.date ?? ''
        const db = b.lessons?.date ?? ''
        return t === 'upcoming' ? da.localeCompare(db) : db.localeCompare(da)
      })
      setBookings(data)
    }
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
            const color = lesson.courses?.color ?? '#6B1F3A'

            return (
              <div key={b.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                {/* Color top bar */}
                <div className="h-1" style={{ backgroundColor: color }} />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    {/* Left: lesson info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <p className="font-semibold text-gray-900">{lesson.courses?.name ?? lesson.lesson_types?.name_en}</p>
                        {lesson.lesson_types?.name_en && lesson.courses?.name && lesson.courses.name !== lesson.lesson_types.name_en && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{lesson.lesson_types.name_en}</span>
                        )}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 mt-2">
                        {b.schools && (
                          <div className="flex items-center gap-1.5 text-xs text-gray-500">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-gray-400">
                              <path d="M8.543 2.232a.75.75 0 0 0-1.085 0l-5.25 5.5A.75.75 0 0 0 2.75 9H4v4a1 1 0 0 0 1 1h1.5a.75.75 0 0 0 .75-.75v-3h1.5v3c0 .414.336.75.75.75H11a1 1 0 0 0 1-1V9h1.25a.75.75 0 0 0 .543-1.268l-5.25-5.5Z" />
                            </svg>
                            <span>{b.schools.name}{b.schools.city ? `, ${b.schools.city}` : ''}</span>
                          </div>
                        )}
                        {lesson.teachers && (
                          <div className="flex items-center gap-1.5 text-xs text-gray-500">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-gray-400">
                              <path fillRule="evenodd" d="M15 8A7 7 0 1 1 1 8a7 7 0 0 1 14 0Zm-5-2a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM8 9.5c-2.029 0-3.5 1.053-3.5 2.5S5.971 14.5 8 14.5s3.5-1.053 3.5-2.5-1.471-2.5-3.5-2.5Z" clipRule="evenodd" />
                            </svg>
                            <span>{lesson.teachers.name}</span>
                          </div>
                        )}
                        {lesson.school_rooms && (
                          <div className="flex items-center gap-1.5 text-xs text-gray-500">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-gray-400">
                              <path fillRule="evenodd" d="m7.539 14.841.003.003.002.002a.755.755 0 0 0 .912 0l.002-.002.003-.003.012-.009a5.57 5.57 0 0 0 .19-.153 15.588 15.588 0 0 0 2.046-2.082c1.101-1.399 2.291-3.521 2.291-6.097a5 5 0 0 0-10 0c0 2.576 1.19 4.698 2.291 6.097a15.591 15.591 0 0 0 2.046 2.082 8.916 8.916 0 0 0 .189.153l.012.01ZM8 8.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" clipRule="evenodd" />
                            </svg>
                            <span>
                              {[lesson.school_rooms.school_locations?.name, lesson.school_rooms.name].filter(Boolean).join(' · ')}
                            </span>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5 text-xs text-gray-500">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-gray-400">
                            <path d="M4.5 3.75a3 3 0 0 0-3 3v.75h21v-.75a3 3 0 0 0-3-3h-15Z" />
                            <path fillRule="evenodd" d="M22.5 9.75h-21v7.5a3 3 0 0 0 3 3h15a3 3 0 0 0 3-3v-7.5Zm-18 3.75a.75.75 0 0 1 .75-.75h6a.75.75 0 0 1 0 1.5h-6a.75.75 0 0 1-.75-.75Zm.75 2.25a.75.75 0 0 0 0 1.5h3a.75.75 0 0 0 0-1.5h-3Z" clipRule="evenodd" />
                          </svg>
                          <span className="capitalize">{b.access_source.replace('_', ' ')}{b.credits_deducted > 0 ? ` · ${b.credits_deducted} credit${b.credits_deducted > 1 ? 's' : ''}` : ''}</span>
                        </div>
                      </div>
                    </div>

                    {/* Right: date + time + actions */}
                    <div className="shrink-0 flex flex-col items-end gap-2">
                      <div className="text-right">
                        <p className="text-sm font-bold text-gray-900">{formatDate(lesson.date)}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{lesson.start_time.slice(0, 5)} – {lesson.end_time.slice(0, 5)}</p>
                      </div>
                      {tab === 'past' && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${b.status === 'attended' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-500'}`}>
                          {b.status === 'attended' ? 'Attended' : 'No-show'}
                        </span>
                      )}
                      {isUpcoming && !isPast && (
                        <button
                          onClick={() => handleCancel(b)}
                          disabled={cancelling === b.id}
                          className="px-3 py-1 border border-gray-200 rounded-lg text-xs text-gray-500 hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition disabled:opacity-40"
                        >
                          {cancelling === b.id ? '...' : 'Cancel'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Status messages */}
                  {cancelResult[b.id] && (
                    <p className="text-xs text-blue-600 mt-3 pt-3 border-t border-gray-50">{cancelResult[b.id]}</p>
                  )}
                  {b.status === 'cancelled' && (
                    <p className={`text-xs mt-2 ${b.credit_refunded ? 'text-green-600' : 'text-red-400'}`}>
                      {b.credit_refunded ? '✓ Credit refunded' : '✗ Credit burned (outside policy)'}
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
