/**
 * Nome del paese nella lingua di chi guarda, dal codice ISO (ES → España /
 * Spagna / Spain). Lo scrive il browser: nessuna lista di nomi da mantenere
 * in cinque lingue, e resta corretta se domani si aggiunge un paese.
 *
 * `fallback` serve perche' il codice puo' mancare: schools.country e' testo
 * libero e non sempre si risolve (backend: geography/services.country_code_for).
 */
export function countryName(
  code: string | null | undefined,
  locale: string,
  fallback = ''
): string {
  if (!code) return fallback
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code.toUpperCase()) ?? fallback
  } catch {
    return fallback
  }
}
