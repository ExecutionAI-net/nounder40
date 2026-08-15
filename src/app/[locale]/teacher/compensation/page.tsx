'use client'

import { useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'

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
}

interface CompensationEntry {
  school: { name: string; city: string } | null
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
  month: string
  entries: CompensationEntry[]
  trend: TrendMonth[]
}

function monthLabel(m: string, uiLocale: string) {
  const [y, mo] = m.split('-').map(Number)
  return new Date(y, mo - 1, 1).toLocaleDateString(uiLocale, { month: 'long', year: 'numeric' })
}

function prevMonth(m: string) {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function nextMonth(m: string) {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export default function TeacherCompensationPage() {
  const t = useTranslations('teacher.compensation')
  const uiLocale = useLocale()
  const [month, setMonth] = useState(currentMonth())
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/teacher/compensation?month=${month}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
  }, [month])

  const isCurrentMonth = month === currentMonth()
  const canGoNext = month < currentMonth()

  const grandTotal = (data?.entries ?? []).reduce((s, e) => s + e.total, 0)
  const trendMax = Math.max(...(data?.trend ?? []).map(t => t.total), 1)

  return (
    <div className="max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        {/* Month selector */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMonth(prevMonth(month))}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition"
          >
            ←
          </button>
          <span className="text-sm font-medium text-gray-700 w-32 text-center">
            {monthLabel(month, uiLocale)}
          </span>
          <button
            onClick={() => setMonth(nextMonth(month))}
            disabled={!canGoNext}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition disabled:opacity-30 disabled:cursor-not-allowed"
          >
            →
          </button>
          {!isCurrentMonth && (
            <button
              onClick={() => setMonth(currentMonth())}
              className="text-xs text-gray-500 hover:text-gray-900 px-2 py-1 rounded-lg hover:bg-gray-100 transition ml-1"
            >
              Today
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="animate-pulse h-24 bg-gray-100 rounded-xl" />
          <div className="animate-pulse h-48 bg-gray-100 rounded-xl" />
        </div>
      ) : !data || data.entries.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
          {t('noEarnings')}
        </div>
      ) : (
        <>
          {/* Grand total summary */}
          <div className="bg-gray-900 text-white rounded-xl px-5 py-4 mb-6 flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-400 mb-0.5">{t('total')}</p>
              <p className="text-3xl font-bold">€{grandTotal.toFixed(2)}</p>
              <p className="text-xs text-gray-400 mt-0.5">{monthLabel(month, uiLocale)}</p>
            </div>
            <div className="text-right text-xs text-gray-400 space-y-1">
              <p>{data.entries.reduce((s, e) => s + e.lessons.length, 0)} {t('lessons')}</p>
              <p>{data.entries.reduce((s, e) => s + e.bonus_lessons, 0)} with bonus</p>
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
                      className={`w-full rounded-t transition-all ${trendItem.month === month ? 'bg-gray-800' : 'bg-gray-200'}`}
                      style={{ height: `${Math.max((trendItem.total / trendMax) * 48, trendItem.total > 0 ? 4 : 0)}px` }}
                    />
                    <span className={`text-[10px] ${trendItem.month === month ? 'text-gray-800 font-semibold' : 'text-gray-400'}`}>
                      {new Date(trendItem.month + '-01').toLocaleDateString(uiLocale, { month: 'short' })}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-1">
                {data.trend.map(trendItem => (
                  <div key={trendItem.month} className="flex-1 text-center">
                    <span className={`text-[10px] ${trendItem.month === month ? 'text-gray-800 font-semibold' : 'text-gray-400'}`}>
                      {trendItem.total > 0 ? `€${trendItem.total.toFixed(0)}` : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Per-school entries */}
          <div className="space-y-5">
            {data.entries.map((entry, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                {/* School header */}
                <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-gray-900">{entry.school?.name ?? '—'}</p>
                    <p className="text-xs text-gray-400">{entry.school?.city}</p>
                  </div>
                  <div className="text-right flex flex-col items-end gap-2">
                    <p className="text-xl font-bold text-gray-900">€{entry.total.toFixed(2)}</p>
                    {/* Payment status */}
                    {entry.payment ? (
                      <div className="group relative">
                        <span className={`text-xs font-medium px-2.5 py-1 rounded-full cursor-default ${
                          entry.payment.status === 'paid'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-yellow-50 text-yellow-700'
                        }`}>
                          {entry.payment.status === 'paid' ? 'Paid' : 'Pending'}
                        </span>
                        {(entry.payment.paid_at || entry.payment.note) && (
                          <div className="absolute bottom-full right-0 mb-1.5 hidden group-hover:block z-10 w-52">
                            <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 leading-relaxed shadow-lg">
                              {entry.payment.paid_at && (
                                <p>Paid on {new Date(entry.payment.paid_at).toLocaleDateString(uiLocale, { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                              )}
                              {entry.payment.note && <p className="mt-0.5 text-gray-300">{entry.payment.note}</p>}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : entry.total > 0 ? (
                      <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-yellow-50 text-yellow-700">
                        Pending
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
                  <table className="w-full text-sm">
                    <thead className="border-b border-gray-50">
                      <tr>
                        <th className="text-left px-5 py-2.5 text-xs font-medium text-gray-400">{t('month')}</th>
                        <th className="text-left px-5 py-2.5 text-xs font-medium text-gray-400">{t('month')}</th>
                        <th className="text-left px-5 py-2.5 text-xs font-medium text-gray-400">{t('sectionPlans')}</th>
                        <th className="text-left px-5 py-2.5 text-xs font-medium text-gray-400">Students</th>
                        <th className="text-right px-5 py-2.5 text-xs font-medium text-gray-400">{t('baseFee')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {entry.lessons.map(l => (
                        <tr key={l.id}>
                          <td className="px-5 py-2.5 text-gray-500">
                            {new Date(l.date).toLocaleDateString(uiLocale, { month: 'short', day: 'numeric' })} {l.start_time?.slice(0, 5)}
                          </td>
                          <td className="px-5 py-2.5 text-gray-900">{l.course ?? '—'}</td>
                          <td className="px-5 py-2.5">
                            {l.plan_name
                              ? <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{l.plan_name}</span>
                              : <span className="text-xs text-amber-600">No plan</span>
                            }
                          </td>
                          <td className="px-5 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <span className="text-gray-500">{l.students}</span>
                              {l.has_bonus && (
                                <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">+bonus</span>
                              )}
                              {!l.has_bonus && l.threshold_gap > 0 && (
                                <span className="text-[10px] text-gray-400">{l.threshold_gap} to bonus</span>
                              )}
                            </div>
                          </td>
                          <td className="px-5 py-2.5 text-right">
                            <span className={`font-medium ${l.has_bonus ? 'text-green-700' : l.fee === 0 ? 'text-gray-300' : 'text-gray-900'}`}>
                              {l.fee === 0 ? '—' : `€${l.fee.toFixed(2)}`}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
