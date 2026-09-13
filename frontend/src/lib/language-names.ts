// Nome di una lingua nella lingua dell'utente ("Italian" per en, "Italiano"
// per it, "Italienisch" per de), come già facciamo per i paesi con
// Intl.DisplayNames: nessuna chiave di traduzione per ogni combinazione.

export function languageDisplayName(code: string, uiLocale: string): string {
  try {
    const name = new Intl.DisplayNames([uiLocale], { type: 'language' }).of(code)
    if (name) return name.charAt(0).toLocaleUpperCase(uiLocale) + name.slice(1)
  } catch {
    // codice non valido o Intl non disponibile: si mostra il codice
  }
  return code.toUpperCase()
}
