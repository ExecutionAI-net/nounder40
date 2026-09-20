'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import EventForm from '@/components/school/EventForm'

export default function NewEventPage() {
  const t = useTranslations('school.events.form')
  const router = useRouter()
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">{t('newTitle')}</h1>
      <p className="text-sm text-gray-500 mb-6">{t('newSubtitle')}</p>
      <EventForm
        initial={null}
        onSaved={(event, submitted) => {
          // A draft stays open so the image can be uploaded; a submitted
          // event goes back to the list with its "pending" badge.
          router.push(submitted ? '/school/events' : `/school/events/${event.id}/edit?saved=1`)
        }}
      />
    </div>
  )
}
