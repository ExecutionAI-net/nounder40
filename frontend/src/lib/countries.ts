import { countryName } from '@/lib/country-name'

// Paesi selezionabili nei profili scuola: specchio di backend
// geography/services._ALIASES. Aggiungere un paese = una riga qui e una la'.
export const COUNTRY_CODES = [
  // Europa + Turchia + USA
  'IT', 'ES', 'FR', 'DE', 'GB', 'TR', 'PT', 'NL', 'BE', 'CH', 'AT', 'IE', 'GR', 'PL', 'SE', 'DK', 'NO', 'FI', 'US',
  // America Latina
  'BR', 'AR', 'CL', 'CO', 'MX', 'PR',
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

// Dialling code per country the platform knows, mirror of DIAL_CODES in
// backend students/services.py: the default prefix for phone numbers imported
// without one is the school's own country.
export const DIAL_CODES: Record<string, string> = {
  IT: '+39', ES: '+34', FR: '+33', DE: '+49', GB: '+44', TR: '+90', PT: '+351', NL: '+31', BE: '+32', CH: '+41',
  AT: '+43', IE: '+353', GR: '+30', PL: '+48', SE: '+46', DK: '+45', NO: '+47', FI: '+358', US: '+1',
  BR: '+55', AR: '+54', CL: '+56', CO: '+57', MX: '+52', PR: '+1 787',
}

export function dialCodeFor(code: string | null | undefined): string | null {
  return DIAL_CODES[(code ?? '').toUpperCase()] ?? null
}
