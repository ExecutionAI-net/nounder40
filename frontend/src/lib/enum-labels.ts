import { useTranslations } from 'next-intl'

/**
 * I18N-R3-02 / TCH-R3-03: le tende dei filtri sono localizzate (PR #110), ma
 * i badge che mostrano gli STESSI valori li stampavano grezzi — "Intermediate"
 * accanto a un filtro che dice "Intermedio", e "ALL" per `language=all`.
 *
 * Qui non nascono chiavi nuove: si leggono quelle che i filtri usano gia'.
 * Un solo posto, perche' i badge sono tre (vetrina, libreria insegnante,
 * libreria HQ) e la prossima lista che mostra un livello non deve inventarsi
 * la quarta copia.
 *
 * Un valore sconosciuto torna cosi' com'e': meglio "expert" che una stringa
 * di errore o il vuoto.
 */

const LEVEL_KEYS: Record<string, string> = {
  entry: 'levelEntry',
  intermediate: 'levelIntermediate',
  advanced: 'levelAdvanced',
  all: 'levelAll',
}

const LANGUAGE_KEYS: Record<string, string> = {
  all: 'filterAllLanguages',
  en: 'filterEnglish',
  it: 'filterItalian',
  fr: 'filterFrench',
  es: 'filterSpanish',
}

export function useLevelLabel() {
  const t = useTranslations('hq.lesson-types')
  return (level?: string | null) => {
    const key = LEVEL_KEYS[String(level ?? '').toLowerCase()]
    return key ? t(key) : (level ?? '')
  }
}

export function useContentLanguageLabel() {
  const t = useTranslations('hq.library')
  return (language?: string | null) => {
    const key = LANGUAGE_KEYS[String(language ?? '').toLowerCase()]
    return key ? t(key) : (language ?? '').toUpperCase()
  }
}
