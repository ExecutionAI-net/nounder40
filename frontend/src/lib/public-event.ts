import { headers } from 'next/headers'
import type { Lesson } from '@/app/[locale]/student/book/BookClient'
import { serverApiFetch } from '@/lib/api/server'

// Server-side helpers for the special-event share preview (Open Graph).
// Only for Server Components / generateMetadata.

// The same /student/events/<slug>/ payload BookClient types as Lesson —
// one contract, not two hand-kept copies.
export type PublicEvent = Pick<Lesson, 'id' | 'date' | 'start_time' | 'end_time' | 'is_online' | 'courses' | 'schools'>

// The public endpoint answers only a live event (approved, scheduled, not
// past); anything else — 404, network, timeout — is "no preview". Cached
// for a minute: a preview does not need per-request freshness, and a
// logged-in student navigating here must not wait on Django twice.
// The slug guard mirrors django's slugify (catalog/events.py::clean_slug):
// letters, digits, hyphens and underscores.
export async function fetchPublicEvent(slug: string): Promise<PublicEvent | null> {
  if (!/^[a-z0-9_-]{1,255}$/i.test(slug)) return null
  return serverApiFetch<PublicEvent>(`/student/events/${slug}/`, { revalidate: 60 })
}

// The origin the visitor sees, so og:image and og:url are absolute.
// NEXT_PUBLIC_APP_URL first: it is the public URL every environment sets
// (DEPLOYMENT.md, the backend's FRONTEND_URL). Behind the local nginx the
// Host that reaches this container is the compose name ("frontend:3000":
// nginx.conf's `location /` sets its own proxy headers and drops the
// server-level Host), so the forwarded headers are only the fallback, and
// with no X-Forwarded-Proto the scheme is plain http, never a guess at https.
export async function publicOrigin(): Promise<string> {
  const configured = (process.env.NEXT_PUBLIC_APP_URL ?? '').trim().replace(/\/$/, '')
  if (configured) return configured
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? ''
  const proto = h.get('x-forwarded-proto') ?? 'http'
  return host ? `${proto}://${host}` : ''
}

// Absolute URL of a media path (/media/public/...), unchanged when already absolute
export function absoluteMediaUrl(origin: string, url: string | null | undefined): string | null {
  if (!url) return null
  if (/^https?:\/\//.test(url)) return url
  return `${origin}${url.startsWith('/') ? '' : '/'}${url}`
}
