'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
  teachers: { name: string } | null
  school_rooms: { name: string; school_locations: { name: string } | null } | null
}

function getWeekDates(anchor: Date) {
  const day = anchor.getDay() // 0=Sun
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

export default function SchoolCalendarPage() {
  const supabase = createClient()
  const router = useRouter()
  const [anchor, setAnchor] = useState(() => new Date())
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Lesson | null>(null)

  const weekDates = getWeekDates(anchor)
  const from = toISO(weekDates[0])
  const to = toISO(weekDates[6])

  const fetchLessons = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/school/courses?from=${from}&to=${to}`)
    if (res.ok) setLessons(await res.json())
    setLoading(false)
  }, [from, to])

  useEffect(() => { fetchLessons() }, [fetchLessons])

  // Supabase Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('lessons-realtime')
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

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Calendar</h1>
          <p className="text-gray-500 text-sm mt-0.5">{monthLabel}</p>
        </div>
        <div className="flex items-center gap-3">
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
          <Link
            href="/school/courses/new"
            className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition"
          >
            + New Course
          </Link>
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
                <div key={i} className={`p-3 text-center border-r border-gray-100 last:border-r-0 ${isToday ? 'bg-[#6B1F3A]/5' : ''}`}>
                  <p className="text-xs text-gray-400 font-medium">{DAYS[i]}</p>
                  <p className={`text-lg font-bold mt-0.5 ${isToday ? 'text-[#6B1F3A]' : 'text-gray-800'}`}>
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
                <div key={i} className={`p-2 border-r border-gray-100 last:border-r-0 space-y-1.5 ${isToday ? 'bg-[#6B1F3A]/5' : ''}`}>
                  {loading && i === 0 && (
                    <div className="text-xs text-gray-300 mt-2">Loading...</div>
                  )}
                  {dayLessons.map((l) => (
                    <button
                      key={l.id}
                      onClick={() => setSelected(l)}
                      className="w-full text-left rounded-lg px-2 py-1.5 text-xs transition hover:opacity-80"
                      style={{ backgroundColor: l.courses?.color ?? '#6B1F3A', color: '#fff' }}
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
                style={{ backgroundColor: selected.courses?.color ?? '#6B1F3A' }}
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
              <Row label="Teacher" value={selected.teachers?.name ?? '—'} />
              <Row label="Room" value={
                selected.school_rooms
                  ? `${selected.school_rooms.school_locations?.name ?? ''} · ${selected.school_rooms.name}`
                  : '—'
              } />
              <Row label="Bookings" value={`${selected.current_bookings} / ${selected.max_capacity}`} />
              <Row label="Credits" value={`${selected.courses?.credit_cost ?? 1} credit(s)`} />
            </div>

            <div className={`text-xs px-2 py-1 rounded-full text-center font-medium ${
              selected.current_bookings >= selected.max_capacity
                ? 'bg-red-100 text-red-600'
                : 'bg-green-100 text-green-600'
            }`}>
              {selected.current_bookings >= selected.max_capacity ? 'Full' : `${selected.max_capacity - selected.current_bookings} spots available`}
            </div>

            {selected.course_id && (
              <button
                onClick={() => router.push(`/school/courses/${selected.course_id}/edit`)}
                className="w-full text-center text-xs text-[#6B1F3A] border border-[#6B1F3A]/30 rounded-lg py-2 hover:bg-[#6B1F3A]/5 transition font-medium"
              >
                Edit Course
              </button>
            )}
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
