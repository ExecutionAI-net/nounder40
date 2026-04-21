import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const LOCALES_TO_FILL = ['it', 'es', 'fr', 'de'] as const
const BATCH_SIZE = 50
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

async function translateBatch(
  pairs: { key: string; en: string }[],
  targetLocale: string
): Promise<{ key: string; value: string }[]> {
  const localeNames: Record<string, string> = {
    it: 'Italian', es: 'Spanish', fr: 'French', de: 'German',
  }

  const prompt = `You are a professional translator for a classical dance school SaaS platform called "No Under 40".

Translate the following UI strings from English to ${localeNames[targetLocale]}.

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
${JSON.stringify(pairs, null, 2)}`

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
  const text = data.content[0].text.trim()
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('No JSON array in response')
  return JSON.parse(match[0])
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

  // Fetch all EN translations with non-empty values
  const pageSize = 1000
  let enKeys: { key: string; value: string }[] = []
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from('translations')
      .select('key, value')
      .eq('locale', 'en')
      .neq('value', '')
      .not('value', 'is', null)
      .range(offset, offset + pageSize - 1)
    if (!data?.length) break
    enKeys = enKeys.concat(data)
    if (data.length < pageSize) break
    offset += pageSize
  }

  if (!enKeys.length) return NextResponse.json({ filled: 0 })

  // For each target locale, find keys with missing/empty translations
  let totalFilled = 0

  for (const locale of LOCALES_TO_FILL) {
    const { data: existing } = await supabase
      .from('translations')
      .select('key, value')
      .eq('locale', locale)
      .in('key', enKeys.map(k => k.key))

    const existingMap = new Map((existing ?? []).map(r => [r.key, r.value]))
    const missing = enKeys.filter(k => !(existingMap.get(k.key) ?? '').trim())

    if (!missing.length) continue

    // Translate in batches
    const rows: { key: string; locale: string; value: string; updated_at: string }[] = []
    for (let i = 0; i < missing.length; i += BATCH_SIZE) {
      const batch = missing.slice(i, i + BATCH_SIZE)
      let translated: { key: string; value: string }[]
      let attempts = 0
      while (true) {
        try {
          translated = await translateBatch(
            batch.map(p => ({ key: p.key, en: p.value })),
            locale
          )
          break
        } catch {
          attempts++
          if (attempts >= 3) {
            translated = batch.map(p => ({ key: p.key, value: p.value }))
            break
          }
          await new Promise(r => setTimeout(r, 2000 * attempts))
        }
      }
      rows.push(...translated!.map(t => ({
        key: t.key,
        locale,
        value: t.value,
        updated_at: new Date().toISOString(),
      })))
      await new Promise(r => setTimeout(r, 300))
    }

    // Upsert in chunks of 100
    for (let i = 0; i < rows.length; i += 100) {
      await supabase
        .from('translations')
        .upsert(rows.slice(i, i + 100), { onConflict: 'key,locale' })
    }

    totalFilled += rows.length
  }

  return NextResponse.json({ filled: totalFilled })
}
