import { countryName } from '@/lib/country-name'

// Paesi selezionabili nei profili scuola: specchio di backend
// geography/services._ALIASES. Aggiungere un paese = una riga qui e una la'.
export const COUNTRY_CODES = [
  'IT', 'ES', 'FR', 'DE', 'GB', 'TR', 'PT', 'NL', 'BE', 'CH', 'AT', 'IE', 'GR', 'PL', 'SE', 'DK', 'NO', 'FI', 'US',
] as const

// Bandiera dal codice ISO (lettere → "regional indicator"): nessuna lista di emoji da mantenere
export function flagOf(code: string | null | undefined): string {
  const c = (code ?? '').toUpperCase()
  if (!/^[A-Z]{2}$/.test(c)) return ''
  return String.fromCodePoint(...[...c].map(ch => 0x1f1e6 + ch.charCodeAt(0) - 65))
}

export function countryOptions(locale: string): { code: string; name: string; label: string }[] {
  return COUNTRY_CODES
    .map(code => ({ code, name: countryName(code, locale, code) }))
    .sort((a, b) => a.name.localeCompare(b.name, locale))
    .map(c => ({ ...c, label: `${flagOf(c.code)} ${c.name}` }))
}
