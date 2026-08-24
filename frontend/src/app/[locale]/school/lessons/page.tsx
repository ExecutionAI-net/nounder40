'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Link } from '@/navigation'
import { formatDate } from '@/lib/format-date'
import { lessonTypeName } from '@/lib/lesson-type-name'
import { languageFlag } from '@/lib/languages'
import MultiSelectFilter from '@/components/ui/MultiSelectFilter'
import { apiFetch } from '@/lib/api/client'

// Vista tabellare di tutte le lezioni della scuola (elenco calendario).
type Row = {
  id: string
  date: string
  start_time: string
  end_time: string
  max_capacity: number
  current_bookings: number
  status: string
  course_id: string
  is_online: boolean
  language: string | null   // effective: lesson override or course language
  courses: { name: string | null; color: string; credit_cost: number } | null
  lesson_types: { name_en: string | null; name_it: string | null; name_es?: string | null } | null
  teachers: { name: string } | null
  school_rooms: { name: string; school_locations: { name: string } | null } | null
}

type Tab = 'upcoming' | 'past' | 'all'

export default function SchoolLessonsPage() {
  const t = useTranslations('school.lessons')
  const uiLocale = useLocale()
  const [schoolLang, setSchoolLang] = useState<string | null>(null)
  // nomi tipo lezione nella lingua del profilo scuola; date/etichette nella lingua UI
  const locale = uiLocale
  const nameLang = schoolLang ?? uiLocale
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('upcoming')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [teacher, setTeacher] = useState<string[]>([])
  const [days, setDays] = useState<string[]>([])
  const [hours, setHours] = useState<string[]>([])
  const [locations, setLocations] = useState<string[]>([])
  const [room, setRoom] = useState<string[]>([])
  const [modes, setModes] = useState<string[]>([])

  useEffect(() => {
    async function load() {
      // ampia finestra: 1 anno indietro / 1 anno avanti
      const past = new Date(); past.setFullYear(past.getFullYear() - 1)
      const future = new Date(); future.setFullYear(future.getFullYear() + 1)
      const [rowsData, school] = await Promise.all([
        apiFetch<Row[]>(`/school/lessons-feed/?from=${past.toISOString().split('T')[0]}&to=${future.toISOString().split('T')[0]}`),
        apiFetch<{ language?: string }>('/school/profile/').catch((): { language?: string } => ({})),
      ])
      setRows(rowsData)
      if (school.language) setSchoolLang(school.language)
      setLoading(false)
    }
    load()
  }, [])

  const teachers = useMemo(() => [...new Set(rows.map(r => r.teachers?.name).filter(Boolean))] as string[], [rows])
  const rooms = useMemo(() => [...new Set(rows.map(r => r.school_rooms?.name).filter(Boolean))] as string[], [rows])
  const locationList = useMemo(() => [...new Set(rows.map(r => r.school_rooms?.school_locations?.name).filter(Boolean))] as string[], [rows])
  const hourList = useMemo(() => [...new Set(rows.map(r => r.start_time?.slice(0, 5)).filter(Boolean))].sort() as string[], [rows])

  // giorni della settimana presenti, con etichetta localizzata via Intl (nessuna traduzione necessaria)
  const WEEKDAY_KEYS = useMemo(() => ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'], [])
  const rowWeekday = useMemo(() => (r: Row) => WEEKDAY_KEYS[new Date(r.date + 'T12:00:00').getDay()], [WEEKDAY_KEYS])
  const dayList = useMemo(() => {
    const sample: Record<string, string> = { monday: '2026-08-17', tuesday: '2026-08-18', wednesday: '2026-08-19', thursday: '2026-08-20', friday: '2026-08-21', saturday: '2026-08-22', sunday: '2026-08-23' }
    const present = new Set(rows.map(rowWeekday))
    return Object.entries(sample)
      .filter(([k]) => present.has(k))
      .map(([k, d]) => ({ value: k, label: new Date(d + 'T12:00:00').toLocaleDateString(locale, { weekday: 'long' }) }))
  }, [rows, rowWeekday, locale])

  const today = new Date().toISOString().split('T')[0]
  const filtered = useMemo(() => rows.filter(r => {
    if (tab === 'upcoming' && r.date < today) return false
    if (tab === 'past' && r.date >= today) return false
    if (from && r.date < from) return false
    if (to && r.date > to) return false
    if (teacher.length && !teacher.includes(r.teachers?.name ?? '')) return false
    if (days.length && !days.includes(rowWeekday(r))) return false
    if (hours.length && !hours.includes(r.start_time?.slice(0, 5) ?? '')) return false
    if (locations.length && !locations.includes(r.school_rooms?.school_locations?.name ?? '')) return false
    if (room.length && !room.includes(r.school_rooms?.name ?? '')) return false
    if (modes.length && !modes.includes(r.is_online ? 'online' : 'inperson')) return false
    return true
  }).sort((a, b) => tab === 'past'
    ? (b.date + b.start_time).localeCompare(a.date + a.start_time)
    : (a.date + a.start_time).localeCompare(b.date + b.start_time)
  ), [rows, tab, from, to, teacher, days, hours, locations, room, modes, today, rowWeekday])

  const inputCls = 'px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 bg-white'

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-gray-500 text-sm mt-1">{t('subtitle')}</p>
      </div>

      {/* Tabs */}
      <div className="inline-flex bg-gray-100 rounded-xl p-1 mb-4">
        {(['upcoming', 'past', 'all'] as Tab[]).map(k => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${tab === k ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>
            {t(`tab_${k}`)}
          </button>
        ))}
      </div>

      {/* Filtri */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-gray-400">{t('from')}</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-gray-400">{t('to')}</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} />
        </div>
        {/* stesso ordine della pagina Corsi: insegnanti, giorni, orari, sedi, aule, modalità */}
        <MultiSelectFilter label={t('allTeachers')} options={teachers.map(n => ({ value: n, label: n }))} selected={teacher} onChange={setTeacher} />
        <MultiSelectFilter label={t('allDays')} options={dayList} selected={days} onChange={setDays} />
        <MultiSelectFilter label={t('allTimes')} options={hourList.map(h => ({ value: h, label: h }))} selected={hours} onChange={setHours} />
        <MultiSelectFilter label={t('allLocations')} options={locationList.map(n => ({ value: n, label: n }))} selected={locations} onChange={setLocations} />
        <MultiSelectFilter label={t('allRooms')} options={rooms.map(n => ({ value: n, label: n }))} selected={room} onChange={setRoom} />
        <MultiSelectFilter label={t('filterMode')} options={[{ value: 'inperson', label: t('modeInPerson') }, { value: 'online', label: t('modeOnline') }]} selected={modes} onChange={setModes} />
        {(from || to || teacher.length > 0 || days.length > 0 || hours.length > 0 || locations.length > 0 || room.length > 0 || modes.length > 0) && (
          <button onClick={() => { setFrom(''); setTo(''); setTeacher([]); setDays([]); setHours([]); setLocations([]); setRoom([]); setModes([]) }}
            className="text-xs text-gray-400 hover:text-gray-600 underline">
            {t('clearFilters')}
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">{t('loading')}</div>
        ) : !filtered.length ? (
          <div className="p-8 text-center text-sm text-gray-400">{t('empty')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                {['colDate', 'colTime', 'colCourse', 'colTeacher', 'colRoom', 'colMode', 'colBookings', 'colStatus'].map(k => (
                  <th key={k} className="text-left px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide whitespace-nowrap">{t(k)}</th>
                ))}
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(r => (
                <tr key={r.id} className="hover:bg-gray-50 transition">
                  {/* data con giorno della settimana */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-gray-400 capitalize">{new Date(r.date + 'T12:00:00').toLocaleDateString(locale, { weekday: 'short' })}</span>{' '}
                    {formatDate(r.date)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-600">{r.start_time?.slice(0, 5)}–{r.end_time?.slice(0, 5)}</td>
                  {/* nowrap come le altre colonne: la tabella scorre già in
                      orizzontale, senza nowrap questa colonna assorbiva tutta
                      la larghezza libera diventando il doppio del necessario */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="inline-flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r.courses?.color ?? '#6B1F3A' }} />
                      <span className="font-medium text-gray-900">{r.courses?.name?.trim() || lessonTypeName(r.lesson_types, nameLang) || '—'}</span>
                      {r.language && <span title={r.language}>{languageFlag(r.language)}</span>}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{r.teachers?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {r.school_rooms ? `${r.school_rooms.school_locations?.name ?? ''} — ${r.school_rooms.name}` : '—'}
                  </td>
                  {/* online o in sede */}
                  <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                    {r.is_online ? t('modeOnline') : t('modeInPerson')}
                  </td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{r.current_bookings}/{r.max_capacity}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      r.status === 'scheduled' ? 'bg-green-100 text-green-700'
                        : r.status === 'cancelled' ? 'bg-red-100 text-red-600'
                        : 'bg-gray-100 text-gray-500'}`}>
                      {t(`status_${r.status}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <Link href={`/school/courses/${r.course_id}/classes/${r.id}?from=lessons`} className="text-xs text-gray-400 hover:text-gray-700">
                      {t('open')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-gray-400 mt-3">{t('countShown', { count: filtered.length })}</p>
    </div>
  )
}
