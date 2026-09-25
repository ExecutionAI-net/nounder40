import { redirect } from 'next/navigation'

// The short share link of a special event, /dcn40/<slug> (lib/event-share.ts):
// a plain HTTP redirect to the booking page with the event preselected. The
// preview a chat or social network shows comes from that page's metadata —
// every crawler that matters follows redirects.
export default async function EventShortLinkPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params
  redirect(`/${locale}/student/book?event=${encodeURIComponent(slug)}`)
}
