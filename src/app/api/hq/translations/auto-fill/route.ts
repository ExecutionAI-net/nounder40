import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const LOCALES_TO_FILL = ['it', 'es', 'fr', 'de'] as const
const BATCH_SIZE = 50
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

async function callClaude(prompt: string): Promise<string> {
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
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}`)
  const data = await res.json()
  return data.content[0].text.trim()
}

function parseJsonArray(text: string): { key: string; value: string }[] {
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('No JSON array in response')
  return JSON.parse(match[0])
}

async function translateBatch(
  pairs: { key: string; source: string }[],
  fromLocale: string,
  toLocale: string
): Promise<{ key: string; value: string }[]> {
  const localeNames: Record<string, string> = {
    en: 'English', it: 'Italian', es: 'Spanish', fr: 'French', de: 'German',
  }

  const prompt = `You are a professional translator for a classical dance school SaaS platform called "No Under 40".

Translate the following UI strings from ${localeNames[fromLocale]} to ${localeNames[toLocale]}.

STRICT RULES:
1. Keep {placeholders} like {email}, {name}, {count}, {date}, {amount}, {hours} EXACTLY as-is
2. Keep emoji characters exactly as-is
3. Do NOT translate proper nouns: "No Under 40", "Stripe", "Google", "HQ", "PayPal", "POS", "CSV"
4. Keep technical strings like "e.g. FLEX", "you@example.com" as-is
5. Keep symbols: "←", "→", "↑", "+", "..."
6. Use formal/professional register appropriate for a business app
7. Return ONLY a valid JSON array, no other text:
[{"key": "...", "value": "...translated..."}]

Input:
${JSON.stringify(pairs.map(p => ({ key: p.key, source: p.source })), null, 2)}`

  let attempts = 0
  while (true) {
    try {
      const text = await callClaude(prompt)
      return parseJsonArray(text)
    } catch {
      attempts++
      if (attempts >= 3) return pairs.map(p => ({ key: p.key, value: p.source }))
      await new Promise(r => setTimeout(r, 2000 * attempts))
    }
  }
}

async function fetchAllRows(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>,
  locale: string
): Promise<{ key: string; value: string }[]> {
  const pageSize = 1000
  let all: { key: string; value: string }[] = []
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from('translations')
      .select('key, value')
      .eq('locale', locale)
      .range(offset, offset + pageSize - 1)
    if (!data?.length) break
    all = all.concat(data)
    if (data.length < pageSize) break
    offset += pageSize
  }
  return all
}

async function upsertRows(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>,
  rows: { key: string; locale: string; value: string; updated_at: string }[]
) {
  for (let i = 0; i < rows.length; i += 100) {
    await supabase
      .from('translations')
      .upsert(rows.slice(i, i + 100), { onConflict: 'key,locale' })
  }
}

export async function POST() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'hq') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  let totalFilled = 0

  // ── Step 1: Fill missing EN by back-translating from IT ────────────────────
  const [enRows, itRows] = await Promise.all([
    fetchAllRows(supabase, 'en'),
    fetchAllRows(supabase, 'it'),
  ])

  const enMap = new Map(enRows.map(r => [r.key, r.value]))
  const itMap = new Map(itRows.map(r => [r.key, r.value]))

  // Keys where EN is empty but IT has a value
  const missingEn = itRows.filter(r => !(enMap.get(r.key) ?? '').trim() && r.value.trim())

  if (missingEn.length > 0) {
    const enRows2: { key: string; locale: string; value: string; updated_at: string }[] = []
    for (let i = 0; i < missingEn.length; i += BATCH_SIZE) {
      const batch = missingEn.slice(i, i + BATCH_SIZE)
      const translated = await translateBatch(
        batch.map(p => ({ key: p.key, source: p.value })),
        'it', 'en'
      )
      enRows2.push(...translated.map(t => ({
        key: t.key, locale: 'en', value: t.value, updated_at: new Date().toISOString(),
      })))
      await new Promise(r => setTimeout(r, 300))
    }
    await upsertRows(supabase, enRows2)
    totalFilled += enRows2.length
    // Refresh enMap for step 2
    enRows2.forEach(r => enMap.set(r.key, r.value))
  }

  // ── Step 2: Fill missing IT/ES/FR/DE from EN ───────────────────────────────
  const filledEnKeys = [...enMap.entries()]
    .filter(([, v]) => v.trim())
    .map(([key, value]) => ({ key, value }))

  for (const locale of LOCALES_TO_FILL) {
    const existing = locale === 'it' ? itRows : await fetchAllRows(supabase, locale)
    const existingMap = new Map(existing.map(r => [r.key, r.value]))
    const missing = filledEnKeys.filter(k => !(existingMap.get(k.key) ?? '').trim())

    if (!missing.length) continue

    const rows: { key: string; locale: string; value: string; updated_at: string }[] = []
    for (let i = 0; i < missing.length; i += BATCH_SIZE) {
      const batch = missing.slice(i, i + BATCH_SIZE)
      const translated = await translateBatch(
        batch.map(p => ({ key: p.key, source: p.value })),
        'en', locale
      )
      rows.push(...translated.map(t => ({
        key: t.key, locale, value: t.value, updated_at: new Date().toISOString(),
      })))
      await new Promise(r => setTimeout(r, 300))
    }

    await upsertRows(supabase, rows)
    totalFilled += rows.length
  }

  return NextResponse.json({ filled: totalFilled })
}
