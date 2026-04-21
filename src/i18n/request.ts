import { getRequestConfig } from 'next-intl/server'
import { createClient } from '@supabase/supabase-js'
import { routing } from './routing'

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

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale

  if (!locale || !(routing.locales as readonly string[]).includes(locale)) {
    locale = routing.defaultLocale
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const { data, error } = await supabase
    .from('translations')
    .select('key, value')
    .eq('locale', locale)

  if (error) {
    console.error('[i18n] Failed to load translations for', locale, error.message)
  }

  const messages = toNestedMessages(data ?? [])

  return { locale, messages }
})
