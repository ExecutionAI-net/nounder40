// "7 giorni fa / 3 minutes ago / hace 2 horas" — localizzato dal browser
// via Intl.RelativeTimeFormat: nessuna chiave di traduzione da mantenere.
export function timeAgo(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—'
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (diffMin < 1) return rtf.format(0, 'minute') // "adesso" / "this minute"
  if (diffMin < 60) return rtf.format(-diffMin, 'minute')
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return rtf.format(-diffH, 'hour')
  const diffD = Math.floor(diffH / 24)
  if (diffD < 30) return rtf.format(-diffD, 'day')
  return rtf.format(-Math.floor(diffD / 30), 'month')
}
