import { redirect } from 'next/navigation'
import { EVENT_SHARE_PREFIX } from '@/lib/event-share'

// The short link was born as /dcn40/<slug> and renamed to /events/<slug>
// the same day (Carlo, 25/09/2026), but one event link had already been
// shared: this keeps it alive with a redirect to the current short page.
export default async function LegacyEventShortLinkPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params
  redirect(`/${locale}/${EVENT_SHARE_PREFIX}/${encodeURIComponent(slug)}`)
}
