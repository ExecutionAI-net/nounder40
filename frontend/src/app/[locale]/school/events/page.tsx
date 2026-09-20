'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import ConfirmDeleteButton from '@/components/ui/ConfirmDeleteButton'
import ErrorBanner from '@/components/ui/ErrorBanner'
import type { EventPayload } from '@/components/school/EventForm'
import EventStatusBadge from '@/components/school/EventStatusBadge'
import { apiFetch } from '@/lib/api/client'
import { formatMoney } from '@/lib/format-money'

// Special events (SPECIAL_EVENTS.md): the school's own workshops, with the
// HQ approval state of each one. Pending / rejected / suspended ones are
// not on the calendar yet; approved ones link to their lesson register.

export default function SchoolEventsPage() {
  const t = useTranslations('school.events.list')
  const locale = useLocale()
  const [events, setEvents] = useState<EventPayload[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'active' | 'past'>('active')

  async function load() {
    try {
      setEvents(await apiFetch<EventPayload[]>('/school/events/'))
    } catch {
      setError(t('errorLoad'))
    }
    setLoaded(true)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [])

  async function cancelEvent(e: EventPayload) {
    try {
      await apiFetch(`/school/events/${e.id}/`, { method: 'DELETE' })
      await load()
    } catch {
      setError(t('errorCancel'))
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  const visible = events.filter(e => {
    const past = (e.date ?? '') < today || e.status === 'cancelled'
    return filter === 'past' ? past : !past
  })

  function fmtDate(iso: string | null) {
    if (!iso) return '—'
    return new Date(iso + 'T12:00:00').toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('subtitle')}</p>
        </div>
        <Link href="/school/events/new" className="px-4 py-2 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1a31] transition">
          + {t('newEvent')}
        </Link>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-5 w-fit">
        {(['active', 'past'] as const).map(k => (
          <button key={k} onClick={() => setFilter(k)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${filter === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t(k === 'active' ? 'tabUpcoming' : 'tabPast')}
          </button>
        ))}
      </div>

      {!loaded ? (
        <p className="text-sm text-gray-400">{t('loading')}</p>
      ) : visible.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
          <p className="text-gray-500 text-sm">{events.length === 0 ? t('emptyIntro') : t('emptyFilter')}</p>
          {events.length === 0 && (
            <Link href="/school/events/new" className="inline-block mt-3 text-sm text-[#6B1F3A] font-medium hover:underline">
              {t('createFirst')}
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map(e => (
            <div key={e.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="h-1" style={{ backgroundColor: e.color || '#6B1F3A' }} />
              <div className="p-4 flex flex-col md:flex-row md:items-start gap-4">
                {e.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={e.image_url} alt="" className="w-20 h-20 rounded-lg object-cover shrink-0" />
                ) : (
                  <div className="w-20 h-20 rounded-lg bg-gray-100 shrink-0 flex items-center justify-center text-2xl">🎟️</div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-gray-900">{e.name}</p>
                    <EventStatusBadge status={e.status} changed={!!e.changed_at} />
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    📅 {fmtDate(e.date)} · {e.start_time ?? '—'} · {e.duration_minutes} min
                    {e.is_online ? ` · 🌐 ${t('online')}` : e.location_name ? ` · 📍 ${e.location_name}${e.room_name ? ` — ${e.room_name}` : ''}` : ''}
                  </p>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {e.is_free ? t('free') : t('priceLine', { price: formatMoney(e.price, locale) })}
                    {' · '}{t('seats', { booked: e.bookings, max: e.max_capacity })}
                    {e.paid_seats > 0 ? ` · ${t('paidSeats', { count: e.paid_seats })}` : ''}
                    {e.teacher_name ? ` · 👩‍🏫 ${e.teacher_name}` : ''}
                  </p>
                  {(e.status === 'rejected' || e.status === 'suspended') && e.review_note && (
                    <p className="text-sm text-red-600 mt-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                      <span className="font-medium">{t('hqNote')}:</span> {e.review_note}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap md:flex-col gap-2 md:items-end shrink-0">
                  {e.status !== 'cancelled' && (
                    <Link href={`/school/events/${e.id}/edit`} className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 transition">
                      {t('edit')}
                    </Link>
                  )}
                  {e.lesson_id && e.lesson_status !== 'cancelled' && (
                    <Link href={`/school/attendance/${e.lesson_id}`} className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 transition">
                      {t('register')}
                    </Link>
                  )}
                  {e.status !== 'cancelled' && (
                    <ConfirmDeleteButton
                      label={e.lesson_id ? t('cancelEvent') : t('deleteDraft')}
                      armedLabel={
                        e.lesson_id
                          ? (e.paid_seats > 0
                            ? t('cancelArmedPaid', { booked: e.bookings, paid: e.paid_seats })
                            : t('cancelArmed', { booked: e.bookings }))
                          : t('deleteArmed')
                      }
                      onDelete={() => cancelEvent(e)}
                      className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50 transition"
                      armedClassName="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600 text-white"
                    />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
