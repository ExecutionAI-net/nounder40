'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import ErrorBanner from '@/components/ui/ErrorBanner'
import VideoPreviewPlayer from '@/components/ui/VideoPreviewPlayer'
import EventStatusBadge from '@/components/school/EventStatusBadge'
import type { EventPayload } from '@/components/school/EventForm'
import { apiFetch } from '@/lib/api/client'
import { apiErrorMessage } from '@/lib/api/error-message'
import { formatDateWeekday } from '@/lib/format-date'
import { formatMoney } from '@/lib/format-money'

// HQ approval queue for the schools' special events (SPECIAL_EVENTS.md).
// "To approve": new or resubmitted events, hidden from students until HQ
// says yes. "Modified": approved events the school edited afterwards —
// already live, HQ reviews them and may suspend. The other tabs are history.

type Tab = 'pending' | 'modified' | 'approved' | 'suspended' | 'rejected' | 'cancelled'
const TABS: Tab[] = ['pending', 'modified', 'approved', 'suspended', 'rejected', 'cancelled']

type Decision = 'approve' | 'reject' | 'suspend' | 'reviewed'

export default function HQEventsPage() {
  const t = useTranslations('hq.events')
  const locale = useLocale()
  const [tab, setTab] = useState<Tab>('pending')
  const [events, setEvents] = useState<EventPayload[]>([])
  const [counts, setCounts] = useState<{ pending: number; modified: number }>({ pending: 0, modified: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<EventPayload | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<Decision | null>(null)

  const load = useCallback(async (which: Tab) => {
    setLoading(true)
    try {
      const data = await apiFetch<{ results: EventPayload[]; counts: { pending: number; modified: number } }>(`/hq/events/?status=${which}`)
      setEvents(data.results)
      setCounts(data.counts)
    } catch {
      setError(t('errorLoad'))
    }
    setLoading(false)
  }, [t])

  useEffect(() => { load(tab) }, [tab, load])

  async function decide(event: EventPayload, decision: Decision) {
    setBusy(decision)
    setError(null)
    try {
      await apiFetch(`/hq/events/${event.id}/${decision}/`, { method: 'POST', body: JSON.stringify({ note }) })
      setOpen(null)
      setNote('')
      await load(tab)
    } catch (err) {
      const code = apiErrorMessage(err, '')
      setError(code ? `${t('errorDecision')} (${code})` : t('errorDecision'))
    }
    setBusy(null)
  }

  function fmtDateTime(iso: string | null) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('subtitle')}</p>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      <div className="flex flex-wrap gap-1 bg-gray-100 rounded-lg p-1 mb-5 w-fit">
        {TABS.map(k => {
          const badge = k === 'pending' ? counts.pending : k === 'modified' ? counts.modified : 0
          return (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition flex items-center gap-1.5 ${tab === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {t(`tab_${k}`)}
              {badge > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#6B1F3A] text-white">{badge}</span>}
            </button>
          )
        })}
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">{t('loading')}</p>
      ) : events.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center text-sm text-gray-400">{t('empty')}</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                <th className="px-4 py-3 font-medium">{t('colEvent')}</th>
                <th className="px-4 py-3 font-medium">{t('colSchool')}</th>
                <th className="px-4 py-3 font-medium">{t('colWhen')}</th>
                <th className="px-4 py-3 font-medium">{t('colPrice')}</th>
                <th className="px-4 py-3 font-medium">{t('colSeats')}</th>
                <th className="px-4 py-3 font-medium">{tab === 'modified' ? t('colChangedAt') : t('colSubmittedAt')}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {events.map(e => (
                <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{e.name}</span>
                      <EventStatusBadge status={e.status} changed={!!e.changed_at} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{e.school?.name}{e.school?.city ? `, ${e.school.city}` : ''}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatDateWeekday(e.date, locale)} · {e.start_time}</td>
                  <td className="px-4 py-3 text-gray-600">{e.is_free ? t('free') : formatMoney(e.price, locale)}</td>
                  <td className="px-4 py-3 text-gray-600">{e.bookings}/{e.max_capacity}</td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtDateTime(tab === 'modified' ? e.changed_at : e.submitted_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => { setOpen(e); setNote('') }} className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 transition">
                      {t('review')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setOpen(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-full overflow-y-auto" onClick={e => e.stopPropagation()}>
            {(open.video_url || open.image_url) && (
              <VideoPreviewPlayer video={open.video_url} image={open.image_url} />
            )}
            <div className="p-6 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg font-semibold text-gray-900">{open.name}</h2>
                    <EventStatusBadge status={open.status} changed={!!open.changed_at} />
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">{open.school?.name}{open.school?.city ? `, ${open.school.city}` : ''}</p>
                </div>
                <button onClick={() => setOpen(null)} className="text-gray-300 hover:text-gray-500 text-xl leading-none">×</button>
              </div>

              {open.description && <p className="text-sm text-gray-600 whitespace-pre-line">{open.description}</p>}

              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm bg-gray-50 rounded-xl p-4">
                <Row label={t('colWhen')} value={`${formatDateWeekday(open.date, locale)} · ${open.start_time ?? ''} · ${t('minutes', { count: open.duration_minutes })}`} />
                <Row label={t('colPrice')} value={open.is_free ? t('free') : formatMoney(open.price, locale)} />
                <Row label={t('colSeats')} value={`${open.bookings}/${open.max_capacity}${open.paid_seats ? ` (${t('paidSeats', { count: open.paid_seats })})` : ''}`} />
                <Row label={t('labelTeacher')} value={open.teacher_name ?? '—'} />
                <Row label={t('labelWhere')} value={open.is_online ? `🌐 ${t('online')}${open.online_link ? ` · ${open.online_link}` : ''}` : [open.location_name, open.room_name].filter(Boolean).join(' — ') || '—'} />
                <Row label={t('labelLanguage')} value={open.language.toUpperCase()} />
                {open.notes && <Row label={t('labelNotes')} value={open.notes} wide />}
                {open.submitted_at && <Row label={t('colSubmittedAt')} value={fmtDateTime(open.submitted_at)} />}
                {open.reviewed_at && <Row label={t('labelReviewed')} value={`${fmtDateTime(open.reviewed_at)}${open.reviewed_by ? ` · ${open.reviewed_by}` : ''}`} />}
              </div>

              {open.review_note && (
                <p className="text-sm text-gray-600"><span className="font-medium">{t('labelPreviousNote')}:</span> {open.review_note}</p>
              )}

              {(open.status === 'pending' || open.status === 'approved') && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t('labelNote')}</label>
                  <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 resize-none"
                    placeholder={t('placeholderNote')} />
                </div>
              )}

              <div className="flex flex-wrap gap-2 justify-end pt-1">
                {(open.status === 'pending' || open.status === 'suspended') && (
                  <button onClick={() => decide(open, 'approve')} disabled={!!busy}
                    className="px-4 py-2 rounded-xl bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition disabled:opacity-50">
                    {busy === 'approve' ? t('working') : open.status === 'suspended' ? t('reinstate') : t('approve')}
                  </button>
                )}
                {open.status === 'pending' && (
                  <button onClick={() => decide(open, 'reject')} disabled={!!busy}
                    className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition disabled:opacity-50">
                    {busy === 'reject' ? t('working') : t('reject')}
                  </button>
                )}
                {open.status === 'approved' && open.changed_at && (
                  <button onClick={() => decide(open, 'reviewed')} disabled={!!busy}
                    className="px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 transition disabled:opacity-50">
                    {busy === 'reviewed' ? t('working') : t('markReviewed')}
                  </button>
                )}
                {open.status === 'approved' && (
                  <button onClick={() => decide(open, 'suspend')} disabled={!!busy}
                    className="px-4 py-2 rounded-xl border border-orange-300 text-orange-700 text-sm font-medium hover:bg-orange-50 transition disabled:opacity-50">
                    {busy === 'suspend' ? t('working') : t('suspend')}
                  </button>
                )}
                <button onClick={() => setOpen(null)} className="px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition">
                  {t('close')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-gray-800 whitespace-pre-line">{value}</p>
    </div>
  )
}
