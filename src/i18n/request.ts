import { getRequestConfig } from 'next-intl/server'
import { routing } from './routing'

// Static dictionaries bundled at build time (messages/<locale>.json) — the
// source of truth. No runtime DB dependency: the app renders correctly even
// if Supabase is unreachable or the translations table is empty/missing.
// Optional live overrides can still be layered in later (see HQ > Translations),
// but the bundled files are always the reliable baseline.
const bundled: Record<string, () => Promise<Record<string, unknown>>> = {
  en: () => import('../../messages/en.json').then(m => m.default),
  it: () => import('../../messages/it.json').then(m => m.default),
  es: () => import('../../messages/es.json').then(m => m.default),
  fr: () => import('../../messages/fr.json').then(m => m.default),
  de: () => import('../../messages/de.json').then(m => m.default),
}

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale

  if (!locale || !(routing.locales as readonly string[]).includes(locale)) {
    locale = routing.defaultLocale
  }

  const messages = await bundled[locale]()
  return { locale, messages }
})
