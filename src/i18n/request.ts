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

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // DEBUG: show fetch result through title key
  let debugInfo = `locale=${locale} url=${!!url} key=${!!key}`

  try {
    const res = await fetch(
      `${url}/rest/v1/translations?select=key,value&locale=eq.${locale}&limit=5000`,
      {
        headers: {
          apikey: key!,
          Authorization: `Bearer ${key}`,
        },
        cache: 'no-store',
      }
    )

    debugInfo += ` status=${res.status}`

    if (!res.ok) {
      const body = await res.text()
      debugInfo += ` err=${body.slice(0, 100)}`
      const messages = toNestedMessages([
        { key: 'hq.dashboard.title', value: debugInfo },
      ])
      return { locale, messages }
    }

    const data: { key: string; value: string }[] = await res.json()
    debugInfo += ` rows=${data.length}`

    if (data.length === 0) {
      const messages = toNestedMessages([
        { key: 'hq.dashboard.title', value: `NO DATA: ${debugInfo}` },
      ])
      return { locale, messages }
    }

    // Real translations loaded — inject debug info into title temporarily
    data.push({ key: 'hq.dashboard.title', value: `OK: ${debugInfo}` })
    return { locale, messages: toNestedMessages(data) }
  } catch (e) {
    debugInfo += ` catch=${String(e).slice(0, 100)}`
    const messages = toNestedMessages([
      { key: 'hq.dashboard.title', value: `FETCH_ERROR: ${debugInfo}` },
    ])
    return { locale, messages }
  }
})
