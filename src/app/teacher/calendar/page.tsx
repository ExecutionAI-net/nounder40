'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

type Lesson = {
  id: string
  date: string
  start_time: string
  end_time: string
  max_capacity: number
  current_bookings: number
  status: string
  courses: { name: string; color: string; credit_cost: number } | null
  lesson_types: { name_en: string } | null
  school_rooms: { name: string; school_locations: { name: string } | null } | null
  schools: { name: string } | null
}

function getWeekDates(anchor: Date) {
  const day = anchor.getDay()
  const monday = new Date(anchor)
  monday.setDate(anchor.getDate() - ((day + 6) % 7))
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })
}

function toISO(d: Date) {
  return d.toISOString().split('T')[0]
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function TeacherCalendarPage() {
  const supabase = createClient()
  const [anchor, setAnchor] = useState(() => new Date())
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Lesson | null>(null)
  const [icalToken, setIcalToken] = useState<string | null>(null)

  const weekDates = getWeekDates(anchor)
  const from = toISO(weekDates[0])
  const to = toISO(weekDates[6])

  const fetchLessons = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/teacher/calendar?from=${from}&to=${to}`)
    if (res.ok) setLessons(await res.json())
    else setLessons([])
    setLoading(false)
  }, [from, to])

  useEffect(() => { fetchLessons() }, [fetchLessons])

  // Fetch iCal token
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setIcalToken(user.id)
    })
  }, [supabase])

  // Supabase Realtime
  useEffect(() => {
    const channel = supabase
      .channel('teacher-lessons-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lessons' }, () => {
        fetchLessons()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [supabase, fetchLessons])

  function prevWeek() { const d = new Date(anchor); d.setDate(d.getDate() - 7); setAnchor(d) }
  function nextWeek() { const d = new Date(anchor); d.setDate(d.getDate() + 7); setAnchor(d) }

  function lessonsForDay(dateStr: string) {
    return lessons.filter((l) => l.date === dateStr)
  }

  const monthLabel = weekDates[0].toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const icalUrl = icalToken ? `${window.location.origin}/api/calendar/student/${icalToken}.ics` : null

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Calendar</h1>
          <p className="text-gray-500 text-sm mt-0.5">{monthLabel}</p>
        </div>
        <div className="flex items-center gap-3">
          {icalUrl && (
            <a
              href={icalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-gray-500 border border-gray-200 bg-white px-3 py-2 rounded-lg hover:bg-gray-50 transition"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M5.75 2a.75.75 0 0 1 .75.75V4h7V2.75a.75.75 0 0 1 1.5 0V4h.25A2.75 2.75 0 0 1 18 6.75v8.5A2.75 2.75 0 0 1 15.25 18H4.75A2.75 2.75 0 0 1 2 15.25v-8.5A2.75 2.75 0 0 1 4.75 4H5V2.75A.75.75 0 0 1 5.75 2Zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75Z" clipRule="evenodd" />
              </svg>
              Subscribe iCal
            </a>
          )}
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1">
            <button onClick={prevWeek} className="p-1.5 hover:bg-gray-100 rounded text-gray-500">←</button>
            <button
              onClick={() => setAnchor(new Date())}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded"
            >
              Today
            </button>
            <button onClick={nextWeek} className="p-1.5 hover:bg-gray-100 rounded text-gray-500">→</button>
          </div>
        </div>
      </div>

      <div className="flex gap-4">
        {/* Calendar grid */}
        <div className="flex-1 bg-white rounded-xl border border-gray-100 overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-7 border-b border-gray-100">
            {weekDates.map((d, i) => {
              const isToday = toISO(d) === toISO(new Date())
              return (
                <div key={i} className={`p-3 text-center border-r border-gray-100 last:border-r-0 ${isToday ? 'bg-gray-800/5' : ''}`}>
                  <p className="text-xs text-gray-400 font-medium">{DAYS[i]}</p>
                  <p className={`text-lg font-bold mt-0.5 ${isToday ? 'text-gray-800' : 'text-gray-800'}`}>
                    {d.getDate()}
                  </p>
                </div>
              )
            })}
          </div>

          {/* Body */}
          <div className="grid grid-cols-7 min-h-96">
            {weekDates.map((d, i) => {
              const dateStr = toISO(d)
              const dayLessons = lessonsForDay(dateStr)
              const isToday = dateStr === toISO(new Date())
              return (
                <div key={i} className={`p-2 border-r border-gray-100 last:border-r-0 space-y-1.5 ${isToday ? 'bg-gray-800/5' : ''}`}>
                  {loading && i === 0 && (
                    <div className="text-xs text-gray-300 mt-2">Loading...</div>
                  )}
                  {dayLessons.map((l) => (
                    <button
                      key={l.id}
                      onClick={() => setSelected(l)}
                      className="w-full text-left rounded-lg px-2 py-1.5 text-xs transition hover:opacity-80"
                      style={{ backgroundColor: l.courses?.color ?? '#374151', color: '#fff' }}
                    >
                      <p className="font-semibold truncate">{l.courses?.name ?? l.lesson_types?.name_en}</p>
                      <p className="opacity-80">{l.start_time.slice(0, 5)}</p>
                      <p className="opacity-70">{l.current_bookings}/{l.max_capacity}</p>
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        </div>

        {/* Lesson detail panel */}
        {selected && (
          <div className="w-72 bg-white rounded-xl border border-gray-100 p-5 space-y-4 self-start">
            <div className="flex items-start justify-between">
              <div
                className="w-3 h-3 rounded-full mt-1 mr-2 flex-shrink-0"
                style={{ backgroundColor: selected.courses?.color ?? '#374151' }}
              />
              <div className="flex-1">
                <p className="font-semibold text-gray-900 text-sm">{selected.courses?.name ?? selected.lesson_types?.name_en}</p>
                <p className="text-xs text-gray-400 mt-0.5">{selected.lesson_types?.name_en}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-300 hover:text-gray-500 text-lg leading-none">×</button>
            </div>

            <div className="space-y-2 text-sm">
              <Row label="Date" value={new Date(selected.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} />
              <Row label="Time" value={`${selected.start_time.slice(0, 5)} – ${selected.end_time.slice(0, 5)}`} />
              <Row label="School" value={selected.schools?.name ?? '—'} />
              <Row label="Room" value={
                selected.school_rooms
                  ? `${selected.school_rooms.school_locations?.name ?? ''} · ${selected.school_rooms.name}`
                  : '—'
              } />
              <Row label="Bookings" value={`${selected.current_bookings} / ${selected.max_capacity}`} />
            </div>

            <div className={`text-xs px-2 py-1 rounded-full text-center font-medium ${
              selected.status === 'completed'
                ? 'bg-blue-100 text-blue-600'
                : selected.current_bookings >= selected.max_capacity
                  ? 'bg-red-100 text-red-600'
                  : 'bg-green-100 text-green-600'
            }`}>
              {selected.status === 'completed'
                ? 'Completed'
                : selected.current_bookings >= selected.max_capacity
                  ? 'Full'
                  : `${selected.max_capacity - selected.current_bookings} spots available`}
            </div>

            <Link
              href={`/teacher/attendance/${selected.id}`}
              className="block w-full text-center bg-gray-800 text-white text-sm font-medium py-2.5 rounded-lg hover:bg-gray-700 transition"
            >
              Mark Attendance
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-gray-400 text-xs">{label}</span>
      <span className="text-gray-800 text-xs text-right">{value}</span>
    </div>
  )
}
