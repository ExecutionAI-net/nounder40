import type { Metadata } from 'next'
import { eventShareMetadata } from '@/lib/event-share-metadata'
import EventShortLinkClient from './EventShortLinkClient'

// The short share link of a special event, /dcn40/<slug> (lib/event-share.ts).
// It is a real page, not a redirect, on purpose: robots.txt disallows
// /*/student/, so a crawler that honours it (Google, LinkedIn, X, Slack)
// would never fetch the booking page's tags — this page serves them at the
// URL that was shared, and the browser then moves to the booking page with
// the event preselected (EventShortLinkClient).

type Props = { params: Promise<{ locale: string; slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params
  return eventShareMetadata(slug, locale)
}

export default async function EventShortLinkPage({ params }: Props) {
  const { locale, slug } = await params
  return <EventShortLinkClient href={`/${locale}/student/book?event=${encodeURIComponent(slug)}`} />
}
