/** UI languages with flag — single list for every language <select> in the app */
export const LANGUAGES = [
  { value: 'it', label: '🇮🇹 Italiano' },
  { value: 'en', label: '🇬🇧 English' },
  { value: 'es', label: '🇪🇸 Español' },
  { value: 'fr', label: '🇫🇷 Français' },
  { value: 'de', label: '🇩🇪 Deutsch' },
]

/** Languages lessons are taught in (also the school language options) */
export const COURSE_LANGUAGES = LANGUAGES.filter((l) => ['it', 'en', 'es'].includes(l.value))

/** Flagged label for a language code, falling back to the raw code */
export function languageLabel(value: string | null | undefined): string {
  return LANGUAGES.find((l) => l.value === value)?.label ?? (value ?? '')
}
