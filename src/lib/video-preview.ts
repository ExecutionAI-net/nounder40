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

// Embeddable player URL from a YouTube/Vimeo link (null if not embeddable)
export function toEmbedUrl(url: string | null): string | null {
  if (!url) return null
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/)
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`
  return null
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
