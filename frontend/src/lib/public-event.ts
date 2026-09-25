import { headers } from 'next/headers'

// Server-side helpers for the special-event share preview (Open Graph).
// Only for Server Components / generateMetadata: they read request headers
// and call Django by its compose DNS name (DJANGO_API_URL), never the JWT.

export type PublicEvent = {
  id: string
  date: string
  start_time: string | null
  end_time: string | null
  is_online: boolean
  courses: { name: string; description: string | null; image_url: string | null; language: string | null } | null
  schools: { name: string; city: string | null } | null
}

// The public /api/student/events/<slug>/ answers only a live event (approved,
// scheduled, not past); anything else — 404, network, timeout — is "no
// preview", never an error page for the visitor.
export async function fetchPublicEvent(slug: string): Promise<PublicEvent | null> {
  if (!/^[a-z0-9-]{1,255}$/.test(slug)) return null
  const base = process.env.DJANGO_API_URL || process.env.API_URL
  if (!base) return null
  try {
    const res = await fetch(`${base}/api/student/events/${slug}/`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    return (await res.json()) as PublicEvent
  } catch {
    return null
  }
}

// The origin the visitor sees, so og:image and og:url are absolute.
// NEXT_PUBLIC_APP_URL first: it is the public URL every environment sets
// (DEPLOYMENT.md, the backend's FRONTEND_URL), while the Host header that
// reaches this container is the compose name ("frontend:3000") behind the
// local nginx. The forwarded headers are only the fallback.
export async function publicOrigin(): Promise<string> {
  const configured = (process.env.NEXT_PUBLIC_APP_URL ?? '').trim().replace(/\/$/, '')
  if (configured) return configured
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? ''
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return host ? `${proto}://${host}` : ''
}

// Absolute URL of a media path (/media/public/...), unchanged when already absolute
export function absoluteMediaUrl(origin: string, url: string | null | undefined): string | null {
  if (!url) return null
  if (/^https?:\/\//.test(url)) return url
  return `${origin}${url.startsWith('/') ? '' : '/'}${url}`
}
