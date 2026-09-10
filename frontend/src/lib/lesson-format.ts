// Formattazione condivisa delle card lezione (pacchetti studentessa,
// presenze/dashboard insegnante): stessa resa ovunque.

/**
 * Maiuscola solo sulla prima lettera.
 *
 * ST-R2-14 / I18N-R3-05: il CSS `capitalize` maiuscola OGNI parola, e lo
 * spagnolo mette preposizioni dentro la data — "Lunes, 14 De Sept De 2026".
 * La stessa riga era gia' scritta a mano nel calendario di student/book;
 * ora sta qui, una volta, e le pagine tolgono la classe CSS.
 */
export function capitalizeFirst(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

/** "lunedì 7 set 2026" — giorno della settimana sempre incluso. */
export function formatLessonDate(d: string, locale: string): string {
  return capitalizeFirst(new Date(d + 'T12:00:00').toLocaleDateString(locale, {
    weekday: 'long', day: 'numeric', month: 'short', year: 'numeric',
  }))
}

/** "10:00 – 11:10" (o solo inizio se manca la fine). */
export function formatLessonTime(start?: string | null, end?: string | null): string {
  if (!start) return ''
  return `${start.slice(0, 5)}${end ? ` – ${end.slice(0, 5)}` : ''}`
}

/** "📍 Sede · Sala" oppure "💻 Online"; stringa vuota se non c'è nulla. */
export function placeLabel(
  l: { is_online?: boolean; location_name?: string | null; room_name?: string | null },
  onlineLabel: string,
): string {
  if (l.is_online) return `💻 ${onlineLabel}`
  const place = [l.location_name, l.room_name].filter(Boolean).join(' · ')
  return place ? `📍 ${place}` : ''
}
