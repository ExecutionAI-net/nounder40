'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

type Tab = 'schools' | 'teachers' | 'students'

type SchoolRow = {
  id: string; name: string; city: string; country: string; active: boolean
  platform_fee: number; shop_commission_pct: number
  students: number; teachers: number; lessons: number; revenue: number; shop_commission: number
}
type TeacherRow = {
  id: string; name: string; email: string; active: boolean; schools: string
  lessons: number; hours: number; present: number; no_show: number; attendance_rate: number | null
}
type StudentRow = {
  id: string; name: string; email: string; city: string; school: string; school_id: string | null
  created_at: string; bookings: number; attended: number; no_show: number; cancelled: number
  credits: number; spend: number
}

type Kpis = Record<string, number>

const inputCls = 'px-3 py-1.5 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20'

// Esporta le righe filtrate/ordinate in CSV (valori con virgole tra doppi apici)
function exportCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n')
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// Ordinamento generico: numeri desc/asc, stringhe con localeCompare
function sortRows<T extends Record<string, unknown>>(rows: T[], key: string, dir: 'asc' | 'desc'): T[] {
  return [...rows].sort((a, b) => {
    const av = a[key]
    const bv = b[key]
    let cmp: number
    if (typeof av === 'number' || typeof bv === 'number') {
      cmp = (Number(av) || 0) - (Number(bv) || 0)
    } else {
      cmp = String(av ?? '').localeCompare(String(bv ?? ''))
    }
    return dir === 'asc' ? cmp : -cmp
  })
}

export default function HQReportsPage() {
  const t = useTranslations('hq.reports')
  const now = new Date()
  const [tab, setTab] = useState<Tab>('schools')
  const [from, setFrom] = useState(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10))
  const [to, setTo] = useState(now.toISOString().slice(0, 10))
  const [loading, setLoading] = useState(true)
  const [kpis, setKpis] = useState<Kpis>({})
  const [schoolRows, setSchoolRows] = useState<SchoolRow[]>([])
  const [teacherRows, setTeacherRows] = useState<TeacherRow[]>([])
  const [studentRows, setStudentRows] = useState<StudentRow[]>([])

  // Filtri client-side
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterCountry, setFilterCountry] = useState('')
  const [filterSchool, setFilterSchool] = useState('')

  // Ordinamento
  const [sortKey, setSortKey] = useState('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const res = await fetch(`/api/hq/reports?tab=${tab}&from=${from}&to=${to}`, { cache: 'no-store' })
      if (!cancelled && res.ok) {
        const data = await res.json()
        setKpis(data.kpis ?? {})
        if (tab === 'schools') setSchoolRows(data.rows ?? [])
        if (tab === 'teachers') setTeacherRows(data.rows ?? [])
        if (tab === 'students') setStudentRows(data.rows ?? [])
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [tab, from, to])

  function switchTab(next: Tab) {
    setTab(next)
    setSearch('')
    setFilterStatus('')
    setFilterCountry('')
    setFilterSchool('')
    setSortKey('name')
    setSortDir('asc')
  }

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc') }
  }

  const sortIndicator = (key: string) => sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  // ── Righe filtrate per tab ────────────────────────────────────────────────
  const q = search.trim().toLowerCase()

  const filteredSchools = useMemo(() => sortRows(
    schoolRows.filter(r => {
      if (q && !`${r.name} ${r.city} ${r.country}`.toLowerCase().includes(q)) return false
      if (filterStatus === 'active' && !r.active) return false
      if (filterStatus === 'inactive' && r.active) return false
      if (filterCountry && r.country !== filterCountry) return false
      return true
    }), sortKey, sortDir), [schoolRows, q, filterStatus, filterCountry, sortKey, sortDir])

  const filteredTeachers = useMemo(() => sortRows(
    teacherRows.filter(r => {
      if (q && !`${r.name} ${r.email} ${r.schools}`.toLowerCase().includes(q)) return false
      if (filterStatus === 'active' && !r.active) return false
      if (filterStatus === 'inactive' && r.active) return false
      if (filterSchool && !r.schools.split(', ').includes(filterSchool)) return false
      return true
    }), sortKey, sortDir), [teacherRows, q, filterStatus, filterSchool, sortKey, sortDir])

  const filteredStudents = useMemo(() => sortRows(
    studentRows.filter(r => {
      if (q && !`${r.name} ${r.email} ${r.city} ${r.school}`.toLowerCase().includes(q)) return false
      if (filterSchool && r.school !== filterSchool) return false
      return true
    }), sortKey, sortDir), [studentRows, q, filterSchool, sortKey, sortDir])

  const countries = useMemo(() => Array.from(new Set(schoolRows.map(r => r.country).filter(Boolean))).sort(), [schoolRows])
  const teacherSchools = useMemo(() => Array.from(new Set(teacherRows.flatMap(r => r.schools ? r.schools.split(', ') : []))).sort(), [teacherRows])
  const studentSchools = useMemo(() => Array.from(new Set(studentRows.map(r => r.school).filter(Boolean))).sort(), [studentRows])

  const filtersActive = !!(search || filterStatus || filterCountry || filterSchool)

  // ── Export CSV per tab (righe filtrate) ───────────────────────────────────
  function handleExport() {
    if (tab === 'schools') {
      exportCSV('hq-report-scuole',
        [t('columnSchool'), t('columnCity'), t('columnCountry'), t('columnStatus'), t('columnStudents'), t('columnTeachers'), t('columnLessons'), t('columnRevenue'), t('columnShopCommission'), t('columnFee')],
        filteredSchools.map(r => [r.name, r.city, r.country, r.active ? t('statusActive') : t('statusInactive'), r.students, r.teachers, r.lessons, r.revenue.toFixed(2), r.shop_commission.toFixed(2), `${r.platform_fee}%`]))
    }
    if (tab === 'teachers') {
      exportCSV('hq-report-insegnanti',
        [t('columnTeacher'), 'Email', t('columnSchools'), t('columnStatus'), t('columnLessons'), t('columnHours'), t('columnPresent'), t('columnNoShow'), t('columnAttendanceRate')],
        filteredTeachers.map(r => [r.name, r.email, r.schools, r.active ? t('statusActive') : t('statusInactive'), r.lessons, r.hours, r.present, r.no_show, r.attendance_rate !== null ? `${r.attendance_rate}%` : '—']))
    }
    if (tab === 'students') {
      exportCSV('hq-report-studenti',
        [t('columnStudent'), 'Email', t('columnSchool'), t('columnCity'), t('columnBookings'), t('columnAttended'), t('columnNoShow'), t('columnCancelled'), t('columnCredits'), t('columnSpend'), t('columnRegistered')],
        filteredStudents.map(r => [r.name, r.email, r.school, r.city, r.bookings, r.attended, r.no_show, r.cancelled, r.credits, r.spend.toFixed(2), r.created_at.slice(0, 10)]))
    }
  }

  // KPI per tab
  const kpiCards: { label: string; value: string | number; highlight?: boolean }[] =
    tab === 'schools' ? [
      { label: t('kpiActiveSchools'), value: kpis.active_schools ?? 0 },
      { label: t('kpiTotalStudents'), value: kpis.total_students ?? 0 },
      { label: t('kpiTotalTeachers'), value: kpis.total_teachers ?? 0 },
      { label: t('kpiRevenue'), value: `€${(kpis.revenue ?? 0).toFixed(2)}`, highlight: true },
      { label: t('kpiShopRevenue'), value: `€${(kpis.shop_revenue ?? 0).toFixed(2)}` },
    ] : tab === 'teachers' ? [
      { label: t('kpiTotalTeachers'), value: kpis.total_teachers ?? 0 },
      { label: t('kpiActiveTeachers'), value: kpis.active_teachers ?? 0 },
      { label: t('kpiLessons'), value: kpis.lessons ?? 0, highlight: true },
      { label: t('kpiHours'), value: kpis.hours ?? 0 },
      { label: t('kpiNoShows'), value: kpis.no_shows ?? 0 },
    ] : [
      { label: t('kpiTotalStudents'), value: kpis.total_students ?? 0 },
      { label: t('kpiNewStudents'), value: kpis.new_students ?? 0 },
      { label: t('kpiBookings'), value: kpis.bookings ?? 0, highlight: true },
      { label: t('kpiAttended'), value: kpis.attended ?? 0 },
      { label: t('kpiSpend'), value: `€${(kpis.spend ?? 0).toFixed(2)}` },
    ]

  const thCls = 'px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide cursor-pointer select-none hover:text-gray-600 transition'
  const rowCount = tab === 'schools' ? filteredSchools.length : tab === 'teachers' ? filteredTeachers.length : filteredStudents.length

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">{t('pageTitle')}</h1>
        <p className="text-gray-500 text-sm mt-0.5">{t('pageDescription')}</p>
      </div>

      {/* Tab + periodo */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex bg-gray-100 rounded-xl p-1">
          {([['schools', t('tabSchools')], ['teachers', t('tabTeachers')], ['students', t('tabStudents')]] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => switchTab(key)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${tab === key ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{t('periodLabel')}</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} />
          <span className="text-xs text-gray-400">→</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} />
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        {kpiCards.map(kpi => (
          <div key={kpi.label} className="bg-white rounded-xl border border-gray-100 p-5">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{kpi.label}</p>
            <p className={`text-2xl font-bold mt-1 ${kpi.highlight ? 'text-[#6B1F3A]' : 'text-gray-900'}`}>
              {loading ? '—' : kpi.value}
            </p>
          </div>
        ))}
      </div>

      {/* Filtri */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('filterSearch')}
          className={`${inputCls} w-52`}
        />
        {tab !== 'students' && (
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={inputCls}>
            <option value="">{t('filterAllStatuses')}</option>
            <option value="active">{t('statusActive')}</option>
            <option value="inactive">{t('statusInactive')}</option>
          </select>
        )}
        {tab === 'schools' && countries.length > 0 && (
          <select value={filterCountry} onChange={e => setFilterCountry(e.target.value)} className={inputCls}>
            <option value="">{t('filterAllCountries')}</option>
            {countries.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {tab === 'teachers' && teacherSchools.length > 0 && (
          <select value={filterSchool} onChange={e => setFilterSchool(e.target.value)} className={inputCls}>
            <option value="">{t('filterAllSchools')}</option>
            {teacherSchools.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        {tab === 'students' && studentSchools.length > 0 && (
          <select value={filterSchool} onChange={e => setFilterSchool(e.target.value)} className={inputCls}>
            <option value="">{t('filterAllSchools')}</option>
            {studentSchools.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        {filtersActive && (
          <button
            onClick={() => { setSearch(''); setFilterStatus(''); setFilterCountry(''); setFilterSchool('') }}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            {t('clearFilters')}
          </button>
        )}
        <div className="flex-1" />
        <span className="text-xs text-gray-400">{t('rowCount', { count: rowCount })}</span>
        {rowCount > 0 && (
          <button
            onClick={handleExport}
            className="text-sm text-[#6B1F3A] border border-[#6B1F3A]/30 px-3 py-1.5 rounded-lg hover:bg-[#6B1F3A]/5 transition"
          >
            {t('buttonExportCSV')}
          </button>
        )}
      </div>

      {/* Tabella */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">{t('loading')}</div>
        ) : rowCount === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">{t('emptyState')}</div>
        ) : tab === 'schools' ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className={`${thCls} text-left`} onClick={() => toggleSort('name')}>{t('columnSchool')}{sortIndicator('name')}</th>
                <th className={`${thCls} text-left`} onClick={() => toggleSort('city')}>{t('columnCity')}{sortIndicator('city')}</th>
                <th className={`${thCls} text-right`} onClick={() => toggleSort('students')}>{t('columnStudents')}{sortIndicator('students')}</th>
                <th className={`${thCls} text-right`} onClick={() => toggleSort('teachers')}>{t('columnTeachers')}{sortIndicator('teachers')}</th>
                <th className={`${thCls} text-right`} onClick={() => toggleSort('lessons')}>{t('columnLessons')}{sortIndicator('lessons')}</th>
                <th className={`${thCls} text-right`} onClick={() => toggleSort('revenue')}>{t('columnRevenue')}{sortIndicator('revenue')}</th>
                <th className={`${thCls} text-right`} onClick={() => toggleSort('shop_commission')}>{t('columnShopCommission')}{sortIndicator('shop_commission')}</th>
                <th className={`${thCls} text-right`} onClick={() => toggleSort('platform_fee')}>{t('columnFee')}{sortIndicator('platform_fee')}</th>
                <th className="px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide text-left">{t('columnStatus')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredSchools.map(r => (
                <tr key={r.id} className="hover:bg-gray-50 transition">
                  <td className="px-4 py-3 font-medium text-gray-900">{r.name}</td>
                  <td className="px-4 py-3 text-gray-500">{r.city}{r.country ? `, ${r.country}` : ''}</td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">{r.students}</td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">{r.teachers}</td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">{r.lessons}</td>
                  <td className="px-4 py-3 text-right font-semibold text-[#6B1F3A]">€{r.revenue.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-green-700">{r.shop_commission > 0 ? `€${r.shop_commission.toFixed(2)}` : '—'}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{r.platform_fee}%</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${r.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {r.active ? t('statusActive') : t('statusInactive')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : tab === 'teachers' ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className={`${thCls} text-left`} onClick={() => toggleSort('name')}>{t('columnTeacher')}{sortIndicator('name')}</th>
                <th className={`${thCls} text-left`} onClick={() => toggleSort('schools')}>{t('columnSchools')}{sortIndicator('schools')}</th>
                <th className={`${thCls} text-right`} onClick={() => toggleSort('lessons')}>{t('columnLessons')}{sortIndicator('lessons')}</th>
                <th className={`${thCls} text-right`} onClick={() => toggleSort('hours')}>{t('columnHours')}{sortIndicator('hours')}</th>
                <th className={`${thCls} text-right`} onClick={() => toggleSort('present')}>{t('columnPresent')}{sortIndicator('present')}</th>
                <th className={`${thCls} text-right`} onClick={() => toggleSort('no_show')}>{t('columnNoShow')}{sortIndicator('no_show')}</th>
                <th className={`${thCls} text-right`} onClick={() => toggleSort('attendance_rate')}>{t('columnAttendanceRate')}{sortIndicator('attendance_rate')}</th>
                <th className="px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide text-left">{t('columnStatus')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredTeachers.map(r => (
                <tr key={r.id} className="hover:bg-gray-50 transition">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{r.name}</p>
                    {r.email && <p className="text-xs text-gray-400">{r.email}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{r.schools || '—'}</td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">{r.lessons}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{r.hours}</td>
                  <td className="px-4 py-3 text-right text-green-700">{r.present}</td>
                  <td className="px-4 py-3 text-right text-red-500">{r.no_show}</td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">
                    {r.attendance_rate !== null ? `${r.attendance_rate}%` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${r.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {r.active ? t('statusActive') : t('statusInactive')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className={`${thCls} text-left`} onClick={() => toggleSort('name')}>{t('columnStudent')}{sortIndicator('name')}</th>
                <th className={`${thCls} text-left`} onClick={() => toggleSort('school')}>{t('columnSchool')}{sortIndicator('school')}</th>
                <th className={`${thCls} text-left`} onClick={() => toggleSort('city')}>{t('columnCity')}{sortIndicator('city')}</th>
                <th className={`${thCls} text-right`} onClick={() => toggleSort('bookings')}>{t('columnBookings')}{sortIndicator('bookings')}</th>
                <th className={`${thCls} text-right`} onClick={() => toggleSort('attended')}>{t('columnAttended')}{sortIndicator('attended')}</th>
                <th className={`${thCls} text-right`} onClick={() => toggleSort('no_show')}>{t('columnNoShow')}{sortIndicator('no_show')}</th>
                <th className={`${thCls} text-right`} onClick={() => toggleSort('cancelled')}>{t('columnCancelled')}{sortIndicator('cancelled')}</th>
                <th className={`${thCls} text-right`} onClick={() => toggleSort('credits')}>{t('columnCredits')}{sortIndicator('credits')}</th>
                <th className={`${thCls} text-right`} onClick={() => toggleSort('spend')}>{t('columnSpend')}{sortIndicator('spend')}</th>
                <th className={`${thCls} text-right`} onClick={() => toggleSort('created_at')}>{t('columnRegistered')}{sortIndicator('created_at')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredStudents.map(r => (
                <tr key={r.id} className="hover:bg-gray-50 transition">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{r.name}</p>
                    {r.email && <p className="text-xs text-gray-400">{r.email}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{r.school || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{r.city || '—'}</td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">{r.bookings}</td>
                  <td className="px-4 py-3 text-right text-green-700">{r.attended}</td>
                  <td className="px-4 py-3 text-right text-red-500">{r.no_show}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{r.cancelled}</td>
                  <td className="px-4 py-3 text-right font-medium text-[#6B1F3A]">{r.credits}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">€{r.spend.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-xs text-gray-400 whitespace-nowrap">
                    {new Date(r.created_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
