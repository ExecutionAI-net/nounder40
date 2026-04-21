import { getRequestConfig } from 'next-intl/server'
import { unstable_cache } from 'next/cache'
import { createClient } from '@supabase/supabase-js'
import { routing, type Locale } from './routing'

// Convert flat keys like "student.book.title" → nested { student: { book: { title: "..." } } }
function toNestedMessages(flat: { key: string; value: string }[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const { key, value } of flat) {
    const parts = key.split('.')
    let current = result
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
        current[parts[i]] = {}
      }
      current = current[parts[i]] as Record<string, unknown>
    }
    current[parts[parts.length - 1]] = value
  }
  return result
}

const fetchTranslations = unstable_cache(
  async (locale: string) => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const { data, error } = await supabase
      .from('translations')
      .select('key, value')
      .eq('locale', locale)

    if (error) {
      console.error('[i18n] Failed to load translations for', locale, error.message)
      return {}
    }
    return toNestedMessages(data ?? [])
  },
  ['translations'],
  { revalidate: 60, tags: ['translations'] }
)

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale

  if (!locale || !(routing.locales as readonly string[]).includes(locale)) {
    locale = routing.defaultLocale
  }

  const messages = await fetchTranslations(locale)

  return { locale, messages }
})

// Cache updated: 2026-04-21 - HQ keys fixed
