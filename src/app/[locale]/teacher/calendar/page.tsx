'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
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

type ViewMode = 'day' | 'week' | 'month' | 'year'

function toISO(d: Date) {
  return d.toISOString().split('T')[0]
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

function getMonthDates(anchor: Date) {
  const year = anchor.getFullYear()
  const month = anchor.getMonth()
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const startOffset = (firstDay.getDay() + 6) % 7
  const totalCells = Math.ceil((startOffset + lastDay.getDate()) / 7) * 7
  return Array.from({ length: totalCells }, (_, i) => {
    const d = new Date(firstDay)
    d.setDate(1 - startOffset + i)
    return d
  })
}

function getRangeForMode(anchor: Date, mode: ViewMode): { from: string; to: string } {
  if (mode === 'day') {
    const s = toISO(anchor)
    return { from: s, to: s }
  }
  if (mode === 'week') {
    const dates = getWeekDates(anchor)
    return { from: toISO(dates[0]), to: toISO(dates[6]) }
  }
  if (mode === 'month') {
    const year = anchor.getFullYear()
    const month = anchor.getMonth()
    return {
      from: toISO(new Date(year, month, 1)),
      to: toISO(new Date(year, month + 1, 0)),
    }
  }
  const year = anchor.getFullYear()
  return { from: `${year}-01-01`, to: `${year}-12-31` }
}

function navigate(anchor: Date, mode: ViewMode, dir: -1 | 1): Date {
  const d = new Date(anchor)
  if (mode === 'day') d.setDate(d.getDate() + dir)
  else if (mode === 'week') d.setDate(d.getDate() + dir * 7)
  else if (mode === 'month') d.setMonth(d.getMonth() + dir)
  else d.setFullYear(d.getFullYear() + dir)
  return d
}

function headerLabel(anchor: Date, mode: ViewMode): string {
  if (mode === 'day') {
    return anchor.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  }
  if (mode === 'week') {
    const dates = getWeekDates(anchor)
    return `${dates[0].toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${dates[6].toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
  }
  if (mode === 'month') {
    return anchor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  }
  return String(anchor.getFullYear())
}

export default function TeacherCalendarPage() {
  const t = useTranslations('teacher.calendar')
  const supabase = createClient()
  const [anchor, setAnchor] = useState(() => new Date())
  const [mode, setMode] = useState<ViewMode>('week')
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Lesson | null>(null)

  const DAYS_SHORT = [t('buttonDay'), t('buttonWeek'), t('buttonMonth'), t('buttonYear')]
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

  const { from, to } = getRangeForMode(anchor, mode)

  const fetchLessons = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/teacher/calendar?from=${from}&to=${to}`)
    if (res.ok) setLessons(await res.json())
    else setLessons([])
    setLoading(false)
  }, [from, to])

  useEffect(() => { fetchLessons() }, [fetchLessons])

  useEffect(() => {
    const channel = supabase
      .channel('teacher-lessons-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lessons' }, () => {
        fetchLessons()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [supabase, fetchLessons])

  function lessonsForDay(dateStr: string) {
    return lessons.filter((l) => l.date === dateStr)
  }

  const today = toISO(new Date())

  return (
    <div>
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
          <p className="text-gray-500 text-sm mt-0.5">{headerLabel(anchor, mode)}</p>
        </div>
        <div className="flex items-center gap-3">
          {/* View mode switcher */}
          <div className="flex bg-white border border-gray-200 rounded-lg p-1 gap-0.5">
            {(['day', 'week', 'month', 'year'] as ViewMode[]).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setSelected(null) }}
                className={`px-3 py-1.5 text-xs font-medium rounded transition capitalize ${
                  mode === m ? 'bg-gray-800 text-white' : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                {t(`button${m.charAt(0).toUpperCase()}${m.slice(1)}`)}
              </button>
            ))}
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1">
            <button onClick={() => setAnchor(navigate(anchor, mode, -1))} className="p-1.5 hover:bg-gray-100 rounded text-gray-500">{t('buttonPrev')}</button>
            <button
              onClick={() => setAnchor(new Date())}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded"
            >
              {mode === 'day' ? t('buttonDay') : mode === 'week' ? t('buttonWeek') : mode === 'month' ? t('buttonMonth') : t('buttonYear')}
            </button>
            <button onClick={() => setAnchor(navigate(anchor, mode, 1))} className="p-1.5 hover:bg-gray-100 rounded text-gray-500">{t('buttonNext')}</button>
          </div>
        </div>
      </div>

      <div className="flex gap-4">
        <div className="flex-1 min-w-0">
          {/* DAY VIEW */}
          {mode === 'day' && (
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className={`p-4 border-b border-gray-100 ${today === toISO(anchor) ? 'bg-gray-800/5' : ''}`}>
                <p className="text-sm font-semibold text-gray-700">
                  {anchor.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              </div>
              <div className="p-4 min-h-64">
                {loading ? (
                  <p className="text-xs text-gray-300">{t('noLessons')}</p>
                ) : lessonsForDay(toISO(anchor)).length === 0 ? (
                  <p className="text-sm text-gray-400 text-center mt-8">{t('emptyStateMonth')}</p>
                ) : (
                  <div className="space-y-2">
                    {lessonsForDay(toISO(anchor))
                      .sort((a, b) => a.start_time.localeCompare(b.start_time))
                      .map((l) => (
                        <button
                          key={l.id}
                          onClick={() => setSelected(l)}
                          className="w-full text-left rounded-xl px-4 py-3 text-sm transition hover:opacity-90 flex items-center gap-4"
                          style={{ backgroundColor: l.courses?.color ?? '#374151', color: '#fff' }}
                        >
                          <div className="text-xs opacity-80 w-16 shrink-0">
                            <p>{l.start_time.slice(0, 5)}</p>
                            <p>{l.end_time.slice(0, 5)}</p>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold truncate">{l.courses?.name ?? l.lesson_types?.name_en}</p>
                            <p className="text-xs opacity-80 truncate">{l.schools?.name ?? '—'} · {l.school_rooms?.name ?? '—'}</p>
                          </div>
                          <div className="text-xs opacity-70 shrink-0">{l.current_bookings}/{l.max_capacity}</div>
                        </button>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* WEEK VIEW */}
          {mode === 'week' && (
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="grid grid-cols-7 border-b border-gray-100">
                {getWeekDates(anchor).map((d, i) => {
                  const isToday = toISO(d) === today
                  return (
                    <div key={i} className={`p-3 text-center border-r border-gray-100 last:border-r-0 ${isToday ? 'bg-gray-800/5' : ''}`}>
                      <p className="text-xs text-gray-400 font-medium">{DAYS_SHORT[i]}</p>
                      <p className={`text-lg font-bold mt-0.5 ${isToday ? 'text-gray-800' : 'text-gray-800'}`}>{d.getDate()}</p>
                    </div>
                  )
                })}
              </div>
              <div className="grid grid-cols-7 min-h-96">
                {getWeekDates(anchor).map((d, i) => {
                  const dateStr = toISO(d)
                  const dayLessons = lessonsForDay(dateStr)
                  const isToday = dateStr === today
                  return (
                    <div key={i} className={`p-2 border-r border-gray-100 last:border-r-0 space-y-1.5 ${isToday ? 'bg-gray-800/5' : ''}`}>
                      {loading && i === 0 && <div className="text-xs text-gray-300 mt-2">{t('noLessons')}</div>}
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
          )}

          {/* MONTH VIEW */}
          {mode === 'month' && (
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="grid grid-cols-7 border-b border-gray-100">
                {DAYS_SHORT.map((d) => (
                  <div key={d} className="p-3 text-center">
                    <p className="text-xs text-gray-400 font-medium">{d}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {getMonthDates(anchor).map((d, i) => {
                  const dateStr = toISO(d)
                  const inMonth = d.getMonth() === anchor.getMonth()
                  const isToday = dateStr === today
                  const dayLessons = lessonsForDay(dateStr)
                  return (
                    <div
                      key={i}
                      className={`min-h-24 p-1.5 border-r border-b border-gray-100 last:border-r-0 ${
                        !inMonth ? 'bg-gray-50/50' : isToday ? 'bg-gray-800/5' : ''
                      }`}
                    >
                      <p className={`text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${
                        isToday ? 'bg-gray-800 text-white' : inMonth ? 'text-gray-700' : 'text-gray-300'
                      }`}>
                        {d.getDate()}
                      </p>
                      {loading && i === 0 ? null : (
                        <div className="space-y-0.5">
                          {dayLessons.slice(0, 3).map((l) => (
                            <button
                              key={l.id}
                              onClick={() => setSelected(l)}
                              className="w-full text-left rounded px-1.5 py-0.5 text-xs truncate transition hover:opacity-80"
                              style={{ backgroundColor: l.courses?.color ?? '#374151', color: '#fff' }}
                            >
                              {l.start_time.slice(0, 5)} {l.courses?.name ?? l.lesson_types?.name_en}
                            </button>
                          ))}
                          {dayLessons.length > 3 && (
                            <p className="text-xs text-gray-400 pl-1">+{dayLessons.length - 3} more</p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* YEAR VIEW */}
          {mode === 'year' && (
            <div className="grid grid-cols-4 gap-4">
              {MONTHS.map((monthName, mi) => {
                const year = anchor.getFullYear()
                const firstDay = new Date(year, mi, 1)
                const lastDay = new Date(year, mi + 1, 0)
                const startOffset = (firstDay.getDay() + 6) % 7
                const totalCells = Math.ceil((startOffset + lastDay.getDate()) / 7) * 7
                const cells = Array.from({ length: totalCells }, (_, i) => {
                  const d = new Date(firstDay)
                  d.setDate(1 - startOffset + i)
                  return d
                })
                const monthLessons = lessons.filter((l) => {
                  const lDate = new Date(l.date)
                  return lDate.getFullYear() === year && lDate.getMonth() === mi
                })
                const lessonDates = new Set(monthLessons.map((l) => l.date))

                return (
                  <div key={mi} className="bg-white rounded-xl border border-gray-100 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-gray-700">{monthName}</p>
                      {monthLessons.length > 0 && (
                        <span className="text-xs text-gray-400">{monthLessons.length} lessons</span>
                      )}
                    </div>
                    <div className="grid grid-cols-7 mb-1">
                      {['M','T','W','T','F','S','S'].map((d, i) => (
                        <div key={i} className="text-center text-[10px] text-gray-300 font-medium">{d}</div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-y-0.5">
                      {cells.map((d, i) => {
                        const dateStr = toISO(d)
                        const inMonth = d.getMonth() === mi
                        const isToday = dateStr === today
                        const hasLesson = lessonDates.has(dateStr)
                        return (
                          <button
                            key={i}
                            disabled={!inMonth || !hasLesson}
                            onClick={() => {
                              if (inMonth && hasLesson) {
                                setAnchor(d)
                                setMode('day')
                              }
                            }}
                            className={`text-[10px] h-5 w-full flex items-center justify-center rounded transition ${
                              !inMonth ? 'text-gray-200' :
                              isToday ? 'bg-gray-800 text-white font-bold' :
                              hasLesson ? 'bg-gray-800/15 text-gray-700 font-medium hover:bg-gray-800/30 cursor-pointer' :
                              'text-gray-500'
                            }`}
                          >
                            {d.getDate()}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Lesson detail panel */}
        {selected && (
          <div className="w-72 bg-white rounded-xl border border-gray-100 p-5 space-y-4 self-start shrink-0">
            <div className="flex items-start justify-between">
              <div
                className="w-3 h-3 rounded-full mt-1 mr-2 shrink-0"
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
              {t('subscribeICal')}
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
