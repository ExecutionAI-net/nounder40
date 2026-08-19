// Esonimi delle città nelle lingue della piattaforma (it/en/es/fr/de).
// Le città sono salvate col nome locale (endonimo); qui la resa per l'utente:
// "Barcelona" → Barcellona (it) / Barcelone (fr), "Milano" → Milan (en) / Mailand (de)…
// Fallback: nome salvato. Aggiungere qui le nuove città man mano che la rete cresce.

type CityNames = Partial<Record<'it' | 'en' | 'es' | 'fr' | 'de', string>>

const CITY_EXONYMS: Record<string, CityNames> = {
  barcelona: { it: 'Barcellona', fr: 'Barcelone' },
  milano: { en: 'Milan', es: 'Milán', fr: 'Milan', de: 'Mailand' },
  roma: { en: 'Rome', fr: 'Rome', de: 'Rom' },
  torino: { en: 'Turin', es: 'Turín', fr: 'Turin', de: 'Turin' },
  firenze: { en: 'Florence', es: 'Florencia', fr: 'Florence', de: 'Florenz' },
  venezia: { en: 'Venice', es: 'Venecia', fr: 'Venise', de: 'Venedig' },
  napoli: { en: 'Naples', es: 'Nápoles', fr: 'Naples', de: 'Neapel' },
  genova: { en: 'Genoa', es: 'Génova', fr: 'Gênes', de: 'Genua' },
  madrid: {},
  sevilla: { it: 'Siviglia', en: 'Seville', fr: 'Séville' },
  valencia: {},
  paris: { it: 'Parigi', es: 'París' },
  lyon: { it: 'Lione', es: 'Lión' },
  marseille: { it: 'Marsiglia', en: 'Marseille', es: 'Marsella' },
  london: { it: 'Londra', es: 'Londres', fr: 'Londres' },
  berlin: { it: 'Berlino', es: 'Berlín' },
  münchen: { it: 'Monaco di Baviera', en: 'Munich', es: 'Múnich', fr: 'Munich' },
  aachen: { it: 'Aquisgrana', es: 'Aquisgrán', fr: 'Aix-la-Chapelle' },
  köln: { it: 'Colonia', en: 'Cologne', es: 'Colonia', fr: 'Cologne' },
  wien: { it: 'Vienna', en: 'Vienna', es: 'Viena', fr: 'Vienne' },
  lisboa: { it: 'Lisbona', en: 'Lisbon', es: 'Lisboa', fr: 'Lisbonne', de: 'Lissabon' },
  bruxelles: { en: 'Brussels', es: 'Bruselas', de: 'Brüssel' },
  praha: { it: 'Praga', en: 'Prague', es: 'Praga', de: 'Prag' },
  athina: { it: 'Atene', en: 'Athens', es: 'Atenas', fr: 'Athènes', de: 'Athen' },
}

export function cityDisplayName(name: string | null | undefined, locale: string): string {
  const n = (name ?? '').trim()
  if (!n) return ''
  const entry = CITY_EXONYMS[n.toLowerCase()]
  return entry?.[locale as keyof CityNames] ?? n
}
