import type { Metadata } from 'next'
import BookClient from './BookClient'
import { eventShareMetadata } from '@/lib/event-share-metadata'

// The booking page itself stays a Client Component (BookClient: the JWT
// lives in localStorage, so the server can never render it). This thin
// server wrapper only adds the share preview of a special event when the
// long link (?event=<slug>) is the one being shared; the short link the
// school hands out, /events/<slug>, carries the same tags itself.

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale } = await params
  const sp = await searchParams
  const slug = typeof sp.event === 'string' ? sp.event : ''
  return eventShareMetadata(slug, locale)
}

export default function StudentBookPage() {
  return <BookClient />
}
