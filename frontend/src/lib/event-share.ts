// The short shareable link of a special event: <origin>/events/<slug>.
// Locale-less on purpose — the i18n middleware adds the visitor's locale and
// app/[locale]/events/[slug] then moves on to /student/book?event=<slug>,
// whose server metadata (Open Graph) gives WhatsApp, Facebook and the others
// the event's title, date and image as the preview.
export const EVENT_SHARE_PREFIX = 'events'

export function eventShareUrl(origin: string, slug: string): string {
  return `${origin}/${EVENT_SHARE_PREFIX}/${encodeURIComponent(slug)}`
}
