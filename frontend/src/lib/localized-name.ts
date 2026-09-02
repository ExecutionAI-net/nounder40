/**
 * Nome tradotto di una riga che porta le sue quattro colonne name_*.
 *
 * Lo schema e' lo stesso per tipi di lezione, pacchetti e abbonamenti, e
 * finora era riscritto a mano in ogni pagina che ne mostrava uno: e' cosi'
 * che la tendina "Pacchetto Crediti" e' rimasta su name_en, mostrando voci
 * senza nome per i pacchetti che l'inglese non ce l'hanno.
 *
 * Ordine: lingua di chi guarda, poi le altre. Il fallback finale lo decide
 * chi chiama, perche' "" va bene in una riga di tabella ma non in una
 * tendina, dove un'opzione muta non si puo' scegliere.
 */
export type TranslatedNames = {
  name_it?: string | null
  name_en?: string | null
  name_fr?: string | null
  name_es?: string | null
} | null | undefined

export function localizedName(row: TranslatedNames, locale: string, fallback = ''): string {
  if (!row) return fallback
  const byLocale: Record<string, string | null | undefined> = {
    it: row.name_it, en: row.name_en, fr: row.name_fr, es: row.name_es,
  }
  return byLocale[locale] || row.name_en || row.name_it || row.name_fr || row.name_es || fallback
}
