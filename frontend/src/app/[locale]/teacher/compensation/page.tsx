'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { apiFetch } from '@/lib/api/client'
import { useTeacherSchool } from '@/lib/teacher-scope'
import { formatMoney } from '@/lib/format-money'
import { formatDate, toISODate } from '@/lib/format-date'
import MultiSelectFilter from '@/components/ui/MultiSelectFilter'

interface LessonFee {
  id: string
  date: string
  start_time: string
  course: string | null
  plan_name: string | null
  students: number
  fee: number
  has_bonus: boolean
  threshold_gap: number
}

interface Payment {
  amount: number
  status: string
  paid_at: string | null
  note: string | null
  outstanding?: number
  effective_status?: string
}

interface CompensationEntry {
  school: { id?: string; name: string; city: string } | null
  lessons: LessonFee[]
  total: number
  bonus_lessons: number
  payment: Payment | null
}

interface TrendMonth {
  month: string
  total: number
}

interface ApiResponse {
  // The calendar month when the period is exactly one, else null (no
  // payment status either: payments are monthly)
  month: string | null
  from: string
  to: string
  entries: CompensationEntry[]
  trend: TrendMonth[]
}

type Range = { from: string; to: string }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// month0 is 0-based and may overflow (-1 = December of the year before)
function monthRange(year: number, month0: number): Range {
  return { from: toISODate(new Date(year, month0, 1)), to: toISODate(new Date(year, month0 + 1, 0)) }
}

function currentMonthRange(): Range {
  const now = new Date()
  return monthRange(now.getFullYear(), now.getMonth())
}

function monthLabel(m: string, uiLocale: string) {
  const [y, mo] = m.split('-').map(Number)
  return new Date(y, mo - 1, 1).toLocaleDateString(uiLocale, { month: 'long', year: 'numeric' })
}

const inputCls = 'text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-200'

export default function TeacherCompensationPage() {
  const t = useTranslations('teacher.compensation')
  const uiLocale = useLocale()
  // Date filter: the current month to start with, any period from there
  // (Carlo, 30/10/2026: previous months were out of reach)
  const [range, setRange] = useState<Range>(currentMonthRange)
  const [filterCourse, setFilterCourse] = useState<string[]>([])
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  // Scuola scelta nella barra laterale: la chiede al server, così anche
  // l'andamento dei 6 mesi è della sola scuola scelta (QA TCH-R5-02)
  const schoolId = useTeacherSchool()

  // A date input is blank while it is being retyped: then nothing is
  // fetched and nothing is said; the message is for a real inversion
  const rangeComplete = ISO_DATE.test(range.from) && ISO_DATE.test(range.to)
  const rangeValid = rangeComplete && range.from <= range.to

  useEffect(() => {
    if (!rangeValid) return
    let stale = false  // a quicker, later request must not be overwritten by this one
    setLoading(true)
    const params = new URLSearchParams({ from: range.from, to: range.to })
    if (schoolId) params.set('school', schoolId)
    apiFetch<ApiResponse>(`/teacher/compensation-overview/?${params}`)
      .then(d => { if (!stale) { setData(d); setLoading(false) } })
      .catch(() => { if (!stale) setLoading(false) })
    return () => { stale = true }
  }, [range.from, range.to, rangeValid, schoolId])

  const current = currentMonthRange()
  const isCurrentMonth = range.from === current.from && range.to === current.to
  // The arrows move by whole months, starting from the month of "from"
  // (from the current month when "from" is blank or half-typed)
  const arrowBase = ISO_DATE.test(range.from) ? range.from : current.from
  const canGoNext = arrowBase < current.from
  const shiftMonth = (delta: number) => {
    const [y, m] = arrowBase.split('-').map(Number)
    setRange(monthRange(y, m - 1 + delta))
  }

  // Course filter: the courses seen in the period, filtered on the client
  // (totals follow the filter; the payment status stays the month's)
  const courseOptions = useMemo(() => {
    const names = new Set<string>()
    for (const e of data?.entries ?? []) for (const l of e.lessons) if (l.course) names.add(l.course)
    return [...names].sort((a, b) => a.localeCompare(b)).map(n => ({ value: n, label: n }))
  }, [data])

  // A course picked in one period that does not exist in the next one is
  // dropped from the filter, so the new period is not shown as empty
  useEffect(() => {
    const names = new Set(courseOptions.map(o => o.value))
    setFilterCourse(f => (f.every(c => names.has(c)) ? f : f.filter(c => names.has(c))))
  }, [courseOptions])

  const entries = useMemo(() => {
    const all = data?.entries ?? []
    if (filterCourse.length === 0) return all
    return all.map(e => {
      const lessons = e.lessons.filter(l => l.course && filterCourse.includes(l.course))
      return {
        ...e,
        lessons,
        total: lessons.reduce((s, l) => s + l.fee, 0),
        bonus_lessons: lessons.filter(l => l.has_bonus).length,
      }
    })
  }, [data, filterCourse])

  const grandTotal = entries.reduce((s, e) => s + e.total, 0)
  const trendMax = Math.max(...(data?.trend ?? []).map(t => t.total), 1)
  // The caption follows the data on screen, not the inputs being edited
  const periodLabel = !data ? '' : data.month
    ? monthLabel(data.month, uiLocale)
    : `${formatDate(data.from)} – ${formatDate(data.to)}`

  return (
    <div className="max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <div className="flex items-center gap-1">
          <button
            onClick={() => shiftMonth(-1)}
            title={t('prevMonth')}
            aria-label={t('prevMonth')}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition"
          >
            ←
          </button>
          <button
            onClick={() => shiftMonth(1)}
            disabled={!canGoNext}
            title={t('nextMonth')}
            aria-label={t('nextMonth')}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition disabled:opacity-30 disabled:cursor-not-allowed"
          >
            →
          </button>
          {!isCurrentMonth && (
            <button
              onClick={() => setRange(currentMonthRange())}
              className="text-xs text-gray-500 hover:text-gray-900 px-2 py-1 rounded-lg hover:bg-gray-100 transition ml-1"
            >
              {t('currentMonth')}
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div>
          <p className="text-xs text-gray-500 mb-1">{t('filterFrom')}</p>
          <input type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} className={inputCls} />
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">{t('filterTo')}</p>
          <input type="date" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} className={inputCls} />
        </div>
        <MultiSelectFilter
          label={t('filterCourse')}
          options={courseOptions}
          selected={filterCourse}
          onChange={setFilterCourse}
        />
      </div>
      {rangeComplete && !rangeValid && <p className="text-xs text-red-500 mb-4">{t('rangeInvalid')}</p>}

      {loading ? (
        <div className="space-y-4">
          <div className="animate-pulse h-24 bg-gray-100 rounded-xl" />
          <div className="animate-pulse h-48 bg-gray-100 rounded-xl" />
        </div>
      ) : !data || entries.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
          {t('noEarnings')}
        </div>
      ) : (
        <>
          {/* Grand total summary */}
          <div className="bg-gray-900 text-white rounded-xl px-5 py-4 mb-6 flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-400 mb-0.5">{t('total')}</p>
              <p className="text-3xl font-bold">{formatMoney(grandTotal, uiLocale)}</p>
              <p className="text-xs text-gray-400 mt-0.5">{periodLabel}</p>
            </div>
            <div className="text-right text-xs text-gray-400 space-y-1">
              <p>{t('lessonsCount', { count: entries.reduce((s, e) => s + e.lessons.length, 0) })}</p>
              <p>{t('withBonus', { count: entries.reduce((s, e) => s + e.bonus_lessons, 0) })}</p>
            </div>
          </div>

          {/* 6-month trend */}
          {data.trend.some(trendItem => trendItem.total > 0) && (
            <div className="bg-white rounded-xl border border-gray-100 px-5 py-4 mb-6">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{t('sectionEarnings')}</p>
              <div className="flex items-end gap-2 h-14">
                {data.trend.map(trendItem => (
                  <div key={trendItem.month} className="flex-1 flex flex-col items-center gap-1">
                    <div
                      className={`w-full rounded-t transition-all ${trendItem.month === data.month ? 'bg-gray-800' : 'bg-gray-200'}`}
                      style={{ height: `${Math.max((trendItem.total / trendMax) * 48, trendItem.total > 0 ? 4 : 0)}px` }}
                    />
                    <span className={`text-[10px] ${trendItem.month === data.month ? 'text-gray-800 font-semibold' : 'text-gray-400'}`}>
                      {new Date(trendItem.month + '-01').toLocaleDateString(uiLocale, { month: 'short' })}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-1">
                {data.trend.map(trendItem => (
                  <div key={trendItem.month} className="flex-1 text-center">
                    <span className={`text-[10px] ${trendItem.month === data.month ? 'text-gray-800 font-semibold' : 'text-gray-400'}`}>
                      {trendItem.total > 0 ? formatMoney(trendItem.total, uiLocale, { decimals: 0 }) : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Per-school entries */}
          <div className="space-y-5">
            {entries.map((entry, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                {/* School header */}
                <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-gray-900">{entry.school?.name ?? '—'}</p>
                    <p className="text-xs text-gray-400">{entry.school?.city}</p>
                  </div>
                  <div className="text-right flex flex-col items-end gap-2">
                    <p className="text-xl font-bold text-gray-900">{formatMoney(entry.total, uiLocale)}</p>
                    {/* Payment status: only for a whole calendar month */}
                    {entry.payment ? (
                      <div className="group relative">
                        {/* TCH-R4-10: a paid month whose total grew afterwards is not "Paid" */}
                        <span className={`text-xs font-medium px-2.5 py-1 rounded-full cursor-default ${
                          entry.payment.effective_status === 'partial'
                            ? 'bg-amber-100 text-amber-800'
                            : entry.payment.status === 'paid'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-yellow-50 text-yellow-700'
                        }`}>
                          {entry.payment.effective_status === 'partial'
                            ? t('partial')
                            : entry.payment.status === 'paid' ? t('paid') : t('pending')}
                        </span>
                        {entry.payment.effective_status === 'partial' && (
                          <p className="text-[11px] text-amber-700 mt-1">
                            {t('paidAmountShort', { amount: formatMoney(entry.payment.amount, uiLocale) })} · {t('outstanding', { amount: formatMoney(entry.payment.outstanding ?? 0, uiLocale) })}
                          </p>
                        )}
                        {(entry.payment.paid_at || entry.payment.note) && (
                          <div className="absolute bottom-full right-0 mb-1.5 hidden group-hover:block z-10 w-52">
                            <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 leading-relaxed shadow-lg">
                              {entry.payment.paid_at && (
                                <p>{t('paidOn', { date: formatDate(entry.payment.paid_at) })}</p>
                              )}
                              {entry.payment.note && <p className="mt-0.5 text-gray-300">{entry.payment.note}</p>}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : data.month && entry.total > 0 ? (
                      <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-yellow-50 text-yellow-700">
                        {t('pending')}
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* Lessons table */}
                {entry.lessons.length === 0 ? (
                  <div className="px-5 py-4 text-sm text-gray-400">
                    {t('noEarnings')}
                  </div>
                ) : (
                  // I18N-R3-01: the card is `overflow-hidden` and this table
                  // had no scroller of its own, so on a 390px phone the
                  // "Compenso base" column — the one a teacher opens this
                  // page for — sat at 472px and could not be reached in any
                  // locale: neither the page nor the card scrolled sideways.
                  // Same wrapper every other wide table in the app uses.
                  <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[44rem]">
                    <thead className="border-b border-gray-50">
                      <tr>
                        <th className="text-left px-5 py-2.5 text-xs font-medium text-gray-400 whitespace-nowrap">{t('month')}</th>
                        <th className="text-left px-5 py-2.5 text-xs font-medium text-gray-400">{t('course')}</th>
                        <th className="text-left px-5 py-2.5 text-xs font-medium text-gray-400 whitespace-nowrap">{t('sectionPlans')}</th>
                        <th className="text-left px-5 py-2.5 text-xs font-medium text-gray-400 whitespace-nowrap">{t('students')}</th>
                        <th className="text-right px-5 py-2.5 text-xs font-medium text-gray-400 whitespace-nowrap">{t('baseFee')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {entry.lessons.map(l => (
                        <tr key={l.id}>
                          <td className="px-5 py-2.5 text-gray-500 whitespace-nowrap">
                            {formatDate(l.date)} {l.start_time?.slice(0, 5)}
                          </td>
                          <td className="px-5 py-2.5 text-gray-900">{l.course ?? '—'}</td>
                          <td className="px-5 py-2.5 whitespace-nowrap">
                            {l.plan_name
                              ? <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{l.plan_name}</span>
                              : <span className="text-xs text-amber-600">{t('noPlan')}</span>
                            }
                          </td>
                          <td className="px-5 py-2.5">
                            <div className="flex items-center gap-1.5 whitespace-nowrap">
                              <span className="text-gray-500">{l.students}</span>
                              {l.has_bonus && (
                                <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">{t('bonusBadge')}</span>
                              )}
                              {!l.has_bonus && l.threshold_gap > 0 && (
                                <span className="text-[10px] text-gray-400">{t('toBonus', { count: l.threshold_gap })}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-5 py-2.5 text-right whitespace-nowrap">
                            <span className={`font-medium ${l.has_bonus ? 'text-green-700' : l.fee === 0 ? 'text-gray-300' : 'text-gray-900'}`}>
                              {l.fee === 0 ? '—' : formatMoney(l.fee, uiLocale)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
