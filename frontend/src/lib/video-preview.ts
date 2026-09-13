// Helpers for course/lesson-type preview videos (YouTube/Vimeo links set by HQ)

import { youtubeId } from './video-embed'

export function videoUrlForLocale(
  lt: { video_url_it?: string | null; video_url_en?: string | null; video_url_fr?: string | null; video_url_es?: string | null } | null | undefined,
  locale: string
): string | null {
  if (!lt) return null
  const byLocale: Record<string, string | null | undefined> = {
    it: lt.video_url_it, en: lt.video_url_en, fr: lt.video_url_fr, es: lt.video_url_es,
  }
  return byLocale[locale] || lt.video_url_en || lt.video_url_it || null
}

// Thumbnail from a YouTube link (used as image fallback when no image is set).
// The link parsing lives in video-embed.ts, shared with the tutorials.
export function youtubeThumbnail(url: string | null): string | null {
  const id = youtubeId(url)
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null
}

// Immagine del tipo lezione nella lingua dell'utente (fallback: generica → EN → IT)
export function imageUrlForLocale(
  lt: { image_url?: string | null; image_url_it?: string | null; image_url_en?: string | null; image_url_fr?: string | null; image_url_es?: string | null } | null | undefined,
  locale: string
): string | null {
  if (!lt) return null
  const byLocale: Record<string, string | null | undefined> = {
    it: lt.image_url_it, en: lt.image_url_en, fr: lt.image_url_fr, es: lt.image_url_es,
  }
  return byLocale[locale] || lt.image_url || lt.image_url_en || lt.image_url_it || null
}
