'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import EventForm, { type EventPayload } from '@/components/school/EventForm'
import EventStatusBadge from '@/components/school/EventStatusBadge'
import { apiFetch } from '@/lib/api/client'

export default function EditEventPage() {
  const t = useTranslations('school.events.form')
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const search = useSearchParams()
  const [event, setEvent] = useState<EventPayload | null>(null)
  const [error, setError] = useState(false)
  const [saved, setSaved] = useState(search.get('saved') === '1')

  useEffect(() => {
    apiFetch<EventPayload>(`/school/events/${params.id}/`).then(setEvent).catch(() => setError(true))
  }, [params.id])

  if (error) return <div className="text-sm text-red-600">{t('errGeneric')}</div>
  if (!event) return <div className="text-sm text-gray-400">{t('loading')}</div>

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 flex-wrap mb-1">
        <h1 className="text-2xl font-bold text-gray-900">{t('editTitle')}</h1>
        <EventStatusBadge status={event.status} changed={!!event.changed_at} />
      </div>
      <p className="text-sm text-gray-500 mb-4">{event.name}</p>
      {saved && (
        <div className="mb-4 bg-green-50 border border-green-200 text-green-700 text-sm rounded-xl px-4 py-3 flex justify-between items-center">
          {t('savedDraftHint')}
          <button onClick={() => setSaved(false)} className="text-green-400 text-xs ml-4">✕</button>
        </div>
      )}
      {(event.status === 'rejected' || event.status === 'suspended') && event.review_note && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
          <span className="font-medium">{t('hqNote')}:</span> {event.review_note}
        </div>
      )}
      <EventForm
        key={event.id}
        initial={event}
        onSaved={(updated, submitted) => {
          setEvent(updated)
          if (submitted) router.push('/school/events')
          else setSaved(true)
        }}
      />
    </div>
  )
}
