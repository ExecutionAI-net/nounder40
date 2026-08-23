'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { apiFetch } from '@/lib/api/client'
import { openTeacherCalendarSocket } from '@/lib/ws'

type Lesson = {
  id: string
  date: string
  start_time: string
  end_time: string
  max_capacity: number
  current_bookings: number
  status: string
  color: string | null
  school_name: string
  teacher_name: string
  lesson_type_name: string
  room_name: string
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

function headerLabel(anchor: Date, mode: ViewMode, uiLocale: string): string {
  if (mode === 'day') {
    return anchor.toLocaleDateString(uiLocale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  }
  if (mode === 'week') {
    const dates = getWeekDates(anchor)
    return `${dates[0].toLocaleDateString(uiLocale, { day: 'numeric', month: 'short' })} – ${dates[6].toLocaleDateString(uiLocale, { day: 'numeric', month: 'short', year: 'numeric' })}`
  }
  if (mode === 'month') {
    return anchor.toLocaleDateString(uiLocale, { month: 'long', year: 'numeric' })
  }
  return String(anchor.getFullYear())
}

export default function TeacherCalendarPage() {
  const t = useTranslations('teacher.calendar')
  const uiLocale = useLocale()
  const [anchor, setAnchor] = useState(() => new Date())
  // Su telefono la vista giorno è l'unica leggibile: si passa a 'day' dopo
  // il mount (deciderlo nel render SSR causerebbe un hydration mismatch)
  const [mode, setMode] = useState<ViewMode>('week')
  useEffect(() => {
    if (window.innerWidth < 768) setMode('day')
  }, [])
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Lesson | null>(null)
  const [teacherId, setTeacherId] = useState<string | null>(null)

  useEffect(() => {
    apiFetch<{ id: string }>('/teacher/profile/').then(profile => setTeacherId(profile.id)).catch(() => {})
  }, [])

  // Nomi giorno/mese nella lingua dell'utente (1–7 giugno 2026 = lun–dom)
  const DAYS_SHORT = Array.from({ length: 7 }, (_, i) =>
    new Date(2026, 5, 1 + i).toLocaleDateString(uiLocale, { weekday: 'short' })
  )
  const MONTHS = Array.from({ length: 12 }, (_, m) =>
    new Date(2026, m, 1).toLocaleDateString(uiLocale, { month: 'long' })
  )

  const { from, to } = getRangeForMode(anchor, mode)

  const fetchLessons = useCallback(async () => {
    setLoading(true)
    try {
      setLessons(await apiFetch<Lesson[]>(`/teacher/lessons/?from=${from}&to=${to}`))
    } catch {
      setLessons([])
    }
    setLoading(false)
  }, [from, to])

  useEffect(() => { fetchLessons() }, [fetchLessons])

  useEffect(() => {
    if (!teacherId) return
    const ws = openTeacherCalendarSocket(teacherId, () => fetchLessons())
    return () => ws.close()
  }, [teacherId, fetchLessons])

  function lessonsForDay(dateStr: string) {
    return lessons.filter((l) => l.date === dateStr)
  }

  const today = toISO(new Date())

  return (
    <div>
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
          <p className="text-gray-500 text-sm mt-0.5">{headerLabel(anchor, mode, uiLocale)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
            <button onClick={() => setAnchor(navigate(anchor, mode, -1))} aria-label={t('buttonPrev')} className="px-2.5 py-1.5 hover:bg-gray-100 rounded text-gray-500">‹</button>
            <button
              onClick={() => setAnchor(new Date())}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded"
            >
              {t('buttonToday')}
            </button>
            <button onClick={() => setAnchor(navigate(anchor, mode, 1))} aria-label={t('buttonNext')} className="px-2.5 py-1.5 hover:bg-gray-100 rounded text-gray-500">›</button>
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
                  {anchor.toLocaleDateString(uiLocale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
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
                          style={{ backgroundColor: l.color || '#374151', color: '#fff' }}
                        >
                          <div className="text-xs opacity-80 w-16 shrink-0">
                            <p>{l.start_time.slice(0, 5)}</p>
                            <p>{l.end_time.slice(0, 5)}</p>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold truncate">{l.lesson_type_name}</p>
                            <p className="text-xs opacity-80 truncate">{l.school_name || '—'} · {l.room_name || '—'}</p>
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
            <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
              <div className="min-w-[700px]">
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
                          style={{ backgroundColor: l.color || '#374151', color: '#fff' }}
                        >
                          <p className="font-semibold truncate">{l.lesson_type_name}</p>
                          <p className="opacity-80">{l.start_time.slice(0, 5)}</p>
                          <p className="opacity-70">{l.current_bookings}/{l.max_capacity}</p>
                        </button>
                      ))}
                    </div>
                  )
                })}
              </div>
              </div>
            </div>
          )}

          {/* MONTH VIEW */}
          {mode === 'month' && (
            <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
              <div className="min-w-[700px]">
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
                              style={{ backgroundColor: l.color || '#374151', color: '#fff' }}
                            >
                              {l.start_time.slice(0, 5)} {l.lesson_type_name}
                            </button>
                          ))}
                          {dayLessons.length > 3 && (
                            <p className="text-xs text-gray-400 pl-1">{t('moreLessons', { count: dayLessons.length - 3 })}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              </div>
            </div>
          )}

          {/* YEAR VIEW */}
          {mode === 'year' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
                        <span className="text-xs text-gray-400">{t('lessonsCount', { count: monthLessons.length })}</span>
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

        {/* Scheda lezione: su mobile foglio in sovrapposizione (chiudi
            toccando fuori o con "Chiudi"), su desktop pannello laterale */}
        {selected && (
          <div
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end justify-center md:static md:z-auto md:bg-transparent md:backdrop-blur-none md:block md:self-start md:shrink-0"
            onClick={() => setSelected(null)}
          >
          <div
            className="w-full max-h-[85dvh] overflow-y-auto rounded-t-2xl md:w-72 md:max-h-none md:overflow-visible md:rounded-xl bg-white border border-gray-100 p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div
                className="w-3 h-3 rounded-full mt-1 mr-2 shrink-0"
                style={{ backgroundColor: selected.color || '#374151' }}
              />
              <div className="flex-1">
                <p className="font-semibold text-gray-900 text-sm">{selected.lesson_type_name}</p>
                <p className="text-xs text-gray-400 mt-0.5">{selected.school_name || '—'}</p>
              </div>
              <button
                onClick={() => setSelected(null)}
                aria-label={t('buttonClose')}
                className="w-8 h-8 -mt-1 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 text-xl leading-none transition"
              >
                ×
              </button>
            </div>

            <div className="space-y-2 text-sm">
              <Row label={t('labelDate')} value={new Date(selected.date + 'T12:00:00').toLocaleDateString(uiLocale, { weekday: 'long', day: 'numeric', month: 'long' })} />
              <Row label={t('labelTime')} value={`${selected.start_time.slice(0, 5)} – ${selected.end_time.slice(0, 5)}`} />
              <Row label={t('labelSchool')} value={selected.school_name || '—'} />
              <Row label={t('labelRoom')} value={selected.room_name || '—'} />
              <Row label={t('labelBookings')} value={`${selected.current_bookings} / ${selected.max_capacity}`} />
            </div>

            <div className={`text-xs px-2 py-1 rounded-full text-center font-medium ${
              selected.status === 'completed'
                ? 'bg-blue-100 text-blue-600'
                : selected.current_bookings >= selected.max_capacity
                  ? 'bg-red-100 text-red-600'
                  : 'bg-green-100 text-green-600'
            }`}>
              {selected.status === 'completed'
                ? t('statusCompleted')
                : selected.current_bookings >= selected.max_capacity
                  ? t('statusFull')
                  : t('spotsAvailable', { count: selected.max_capacity - selected.current_bookings })}
            </div>

            <Link
              href={`/teacher/attendance/${selected.id}`}
              className="block w-full text-center bg-gray-800 text-white text-sm font-medium py-2.5 rounded-lg hover:bg-gray-700 transition"
            >
              {t('buttonAttendance')}
            </Link>
            <button
              onClick={() => setSelected(null)}
              className="md:hidden w-full py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600"
            >
              {t('buttonClose')}
            </button>
          </div>
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
