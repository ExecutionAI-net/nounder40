import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { locales, type Locale } from '@/i18n/routing'
import { absoluteMediaUrl, fetchPublicEvent, publicOrigin } from '@/lib/public-event'
import { EVENT_SHARE_PREFIX } from '@/lib/event-share'

// The share preview of a special event, as Open Graph / Twitter tags: what
// WhatsApp, Facebook, LinkedIn and Google show for the link — they read the
// server HTML and never run JS. Used by the short link page
// (/[locale]/dcn40/<slug>, the URL the school shares) and by the booking
// page with ?event=<slug>. Empty metadata (the site's generic one) when the
// slug is missing or the event is not live.

// og:locale wants language_TERRITORY; the bare next-intl locale is rejected
const OG_LOCALE: Record<Locale, string> = { en: 'en_GB', it: 'it_IT', es: 'es_ES', fr: 'fr_FR', de: 'de_DE' }

export async function eventShareMetadata(slug: string, locale: string): Promise<Metadata> {
  if (!slug) return {}
  const ev = await fetchPublicEvent(slug)
  if (!ev?.courses) return {}

  const origin = await publicOrigin()
  const school = ev.schools
  const title = school ? `${ev.courses.name} · ${school.name}` : ev.courses.name

  // Date and words in the event's own language, not the crawler's (a
  // crawler has no Accept-Language and would get English for an Italian
  // event); the URL locale when the course language is not one of ours.
  const lang = ev.courses.language ?? ''
  const textLocale = ((locales as readonly string[]).includes(lang) ? lang : locale) as Locale
  const t = await getTranslations({ locale: textLocale, namespace: 'student.book' })

  const when = (() => {
    try {
      const d = new Date(`${ev.date}T${ev.start_time ?? '00:00:00'}`)
      const day = d.toLocaleDateString(textLocale, { weekday: 'long', day: 'numeric', month: 'long' })
      return ev.start_time ? `${day} · ${ev.start_time.slice(0, 5)}` : day
    } catch {
      return ev.date
    }
  })()
  const where = ev.is_online ? t('online') : [school?.name, school?.city].filter(Boolean).join(', ')
  const blurb = (ev.courses.description ?? '').replace(/\s+/g, ' ').trim()
  const description = [
    [when, where].filter(Boolean).join(' · '),
    blurb.length > 160 ? `${blurb.slice(0, 157).trimEnd()}…` : blurb,
  ].filter(Boolean).join(' — ')

  const image = absoluteMediaUrl(origin, ev.courses.image_url)
  // The served short page in this locale: canonical == a URL that answers
  // 200 with these tags, not a redirect (Google drops a canonical that
  // redirects; Facebook re-fetches og:url when it differs from the page).
  const url = `${origin}/${locale}/${EVENT_SHARE_PREFIX}/${encodeURIComponent(slug)}`

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
      locale: OG_LOCALE[textLocale],
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
