// Helpers for course/lesson-type preview videos (YouTube/Vimeo links set by HQ)

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

// Thumbnail from a YouTube link (used as image fallback when no image is set)
export function youtubeThumbnail(url: string | null): string | null {
  if (!url) return null
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/)
  return m ? `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg` : null
}
