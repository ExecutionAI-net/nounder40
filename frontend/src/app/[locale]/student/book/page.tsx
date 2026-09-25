import type { Metadata } from 'next'
import BookClient from './BookClient'
import { eventShareUrl } from '@/lib/event-share'
import { absoluteMediaUrl, fetchPublicEvent, publicOrigin } from '@/lib/public-event'

// The booking page itself stays a Client Component (BookClient: the JWT
// lives in localStorage, so the server can never render it). This thin
// server wrapper only exists for the share preview of a special event:
// with ?event=<slug> it asks the public event endpoint (no token needed)
// and puts title, date and image in the HTML as Open Graph tags, which is
// all WhatsApp, Facebook, LinkedIn and Google read — they never run JS.

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale } = await params
  const sp = await searchParams
  const slug = typeof sp.event === 'string' ? sp.event : ''
  if (!slug) return {}
  const ev = await fetchPublicEvent(slug)
  if (!ev?.courses) return {}

  const origin = await publicOrigin()
  const school = ev.schools
  const title = school ? `${ev.courses.name} · ${school.name}` : ev.courses.name

  // The date in the event's own language, not the crawler's (a crawler has
  // no Accept-Language and would get English for an Italian event)
  const dateLocale = ev.courses.language || locale
  const when = (() => {
    try {
      const d = new Date(`${ev.date}T${ev.start_time ?? '00:00:00'}`)
      const day = d.toLocaleDateString(dateLocale, { weekday: 'long', day: 'numeric', month: 'long' })
      return ev.start_time ? `${day} · ${ev.start_time.slice(0, 5)}` : day
    } catch {
      return ev.date
    }
  })()
  const where = ev.is_online
    ? 'Online'
    : [school?.name, school?.city].filter(Boolean).join(', ')
  const blurb = (ev.courses.description ?? '').replace(/\s+/g, ' ').trim()
  const description = [
    [when, where].filter(Boolean).join(' · '),
    blurb.length > 160 ? `${blurb.slice(0, 157).trimEnd()}…` : blurb,
  ].filter(Boolean).join(' — ')

  const image = absoluteMediaUrl(origin, ev.courses.image_url)
  const url = eventShareUrl(origin, slug)

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      siteName: 'No Under 40',
      title,
      description,
      url,
      locale,
      ...(image ? { images: [{ url: image, alt: ev.courses.name }] } : {}),
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  }
}

export default function StudentBookPage() {
  return <BookClient />
}
