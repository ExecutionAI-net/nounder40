import { getRequestConfig } from 'next-intl/server'
import { routing } from './routing'

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

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  try {
    const pageSize = 1000
    let allData: { key: string; value: string }[] = []
    let offset = 0
    let hasMore = true

    while (hasMore) {
      const res = await fetch(
        `${url}/rest/v1/translations?select=key,value&locale=eq.${locale}&offset=${offset}&limit=${pageSize}`,
        {
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
          },
          cache: 'no-store',
        }
      )

      if (!res.ok) {
        console.error('[i18n] Supabase fetch failed:', res.status)
        return { locale, messages: {} }
      }

      const data: { key: string; value: string }[] = await res.json()
      allData = allData.concat(data)

      if (data.length < pageSize) {
        hasMore = false
      } else {
        offset += pageSize
      }
    }

    return { locale, messages: toNestedMessages(allData) }
  } catch (e) {
    console.error('[i18n] fetch error:', e)
    return { locale, messages: {} }
  }
})
