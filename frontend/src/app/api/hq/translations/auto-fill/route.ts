import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export const maxDuration = 300

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  )
}

type Supabase = ReturnType<typeof adminClient>

const LOCALES_TO_FILL = ['it', 'es', 'fr', 'de'] as const
const BATCH_SIZE = 50
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

const LOCALE_NAMES: Record<string, string> = {
  en: 'English', it: 'Italian', es: 'Spanish', fr: 'French', de: 'German',
}

async function translateBatch(
  pairs: { key: string; source: string }[],
  fromLocale: string,
  toLocale: string
): Promise<{ key: string; value: string }[]> {
  const prompt = `You are a professional translator for a classical dance school SaaS platform called "No Under 40".

Translate the following UI strings from ${LOCALE_NAMES[fromLocale]} to ${LOCALE_NAMES[toLocale]}.

STRICT RULES:
1. Keep {placeholders} like {email}, {name}, {count}, {date}, {amount}, {hours} EXACTLY as-is
2. Keep emoji characters exactly as-is
3. Do NOT translate proper nouns: "No Under 40", "Stripe", "Google", "HQ", "PayPal", "POS", "CSV"
4. Keep symbols: "←", "→", "↑", "+", "..."
5. Use formal/professional register for a business app
6. Return ONLY a valid JSON array, no other text:
[{"key": "...", "value": "...translated..."}]

Input:
${JSON.stringify(pairs.map(p => ({ key: p.key, source: p.source })), null, 2)}`

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY!,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 8096,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      if (res.status === 429) throw new Error('rate_limit')
      if (res.status === 401) throw new Error('invalid_api_key')
      if (res.status === 403) throw new Error('quota_exceeded')
      if (!res.ok) throw new Error(`api_error_${res.status}`)
      const data = await res.json()
      const text: string = data.content[0].text.trim()
      const match = text.match(/\[[\s\S]*\]/)
      if (!match) throw new Error('No JSON in response')
      return JSON.parse(match[0])
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      if (error.includes('rate_limit') || error.includes('quota') || error.includes('invalid_api_key')) {
        throw err
      }
      if (attempt === 3) return pairs.map(p => ({ key: p.key, value: p.source }))
      await new Promise(r => setTimeout(r, 2000 * attempt))
    }
  }
  return pairs.map(p => ({ key: p.key, value: p.source }))
}

async function fetchAllRows(supabase: Supabase) {
  // Fetch entire translations table, paginated
  const pageSize = 1000
  let all: { key: string; locale: string; value: string }[] = []
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from('translations')
      .select('key, locale, value')
      .range(offset, offset + pageSize - 1)
    if (!data?.length) break
    all = all.concat(data)
    if (data.length < pageSize) break
    offset += pageSize
  }
  return all
}

async function upsert(
  supabase: Supabase,
  rows: { key: string; locale: string; value: string; updated_at: string }[]
) {
  for (let i = 0; i < rows.length; i += 100) {
    await supabase
      .from('translations')
      .upsert(rows.slice(i, i + 100), { onConflict: 'key,locale' })
  }
}

function deriveEnFromKey(key: string): string {
  const lastSegment = key.split('.').pop() ?? key
  return lastSegment
    .replace(/([A-Z])/g, ' $1')
    .replace(/[-_]/g, ' ')
    .trim()
    .replace(/^\w/, c => c.toUpperCase())
}

export async function POST() {
  try {
    const userSupabase = await createClient()

    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await userSupabase
      .from('profiles').select('role').eq('id', user.id).single()

    if (profile?.role !== 'hq') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
    }

    const supabase = adminClient()

    // ── Fetch all rows once ────────────────────────────────────────────────────
    const allRows = await fetchAllRows(supabase)

    // Build map: key → locale → value
    const db = new Map<string, Map<string, string>>()
    for (const row of allRows) {
      if (!db.has(row.key)) db.set(row.key, new Map())
      db.get(row.key)?.set(row.locale, row.value ?? '')
    }

    const allKeys = [...db.keys()]
    let totalFilled = 0

    // ── Step 1: Ensure every key has a non-empty EN value ─────────────────────
    const toUpsertEn: { key: string; locale: string; value: string; updated_at: string }[] = []

    for (const key of allKeys) {
      const localeMap = db.get(key) ?? new Map<string, string>()
      const enVal = (localeMap.get('en') ?? '').trim()
      if (enVal) continue // already has EN

      // Try to find a source from another locale
      let source = ''
      for (const loc of LOCALES_TO_FILL) {
        const v = (localeMap.get(loc) ?? '').trim()
        if (v) { source = v; break }
      }

      // Fall back to deriving from key name
      if (!source) source = deriveEnFromKey(key)

      localeMap.set('en', source)
      toUpsertEn.push({ key, locale: 'en', value: source, updated_at: new Date().toISOString() })
    }

    if (toUpsertEn.length > 0) {
      await upsert(supabase, toUpsertEn)
      totalFilled += toUpsertEn.length
    }

    // ── Step 2: Translate EN → missing locales ────────────────────────────────
    for (const locale of LOCALES_TO_FILL) {
      const missing: { key: string; source: string }[] = []

      for (const key of allKeys) {
        const localeMap = db.get(key) ?? new Map<string, string>()
        const targetVal = (localeMap.get(locale) ?? '').trim()
        if (targetVal) continue // already filled

        const enVal = (localeMap.get('en') ?? '').trim()
        if (!enVal) continue // no source to translate from

        missing.push({ key, source: enVal })
      }

      if (!missing.length) continue

      const toUpsert2: { key: string; locale: string; value: string; updated_at: string }[] = []
      for (let i = 0; i < missing.length; i += BATCH_SIZE) {
        const batch = missing.slice(i, i + BATCH_SIZE)
        const translated = await translateBatch(batch, 'en', locale)
        for (const t of translated) {
          toUpsert2.push({ key: t.key, locale, value: t.value, updated_at: new Date().toISOString() })
        }
        await new Promise(r => setTimeout(r, 300))
      }

      await upsert(supabase, toUpsert2)
      totalFilled += toUpsert2.length
    }

    return NextResponse.json({ filled: totalFilled })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    if (error.includes('rate_limit')) {
      return NextResponse.json({ error: 'API rate limit exceeded. Please try again later.' }, { status: 429 })
    }
    if (error.includes('quota_exceeded')) {
      return NextResponse.json({ error: 'Anthropic API quota exceeded. Please check your account.' }, { status: 403 })
    }
    if (error.includes('invalid_api_key')) {
      return NextResponse.json({ error: 'Anthropic API key invalid or expired.' }, { status: 401 })
    }
    if (error.includes('api_error')) {
      return NextResponse.json({ error: 'Anthropic API error. Please try again.' }, { status: 502 })
    }
    return NextResponse.json({ error: 'Translation failed: ' + error }, { status: 500 })
  }
}
