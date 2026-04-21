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

  // TEMP DEBUG: hardcoded test to confirm request.ts runs
  const hardcoded = toNestedMessages([
    { key: 'hq.dashboard.title', value: 'DEBUG_WORKS' },
    { key: 'hq.dashboard.newSchool', value: 'DEBUG_WORKS' },
    { key: 'hq.dashboard.statusActive', value: 'DEBUG_WORKS' },
  ])

  return { locale, messages: hardcoded }
})
