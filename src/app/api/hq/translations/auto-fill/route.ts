import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

type Supabase = Awaited<ReturnType<typeof createClient>>

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
      if (!res.ok) throw new Error(`Anthropic ${res.status}`)
      const data = await res.json()
      const text: string = data.content[0].text.trim()
      const match = text.match(/\[[\s\S]*\]/)
      if (!match) throw new Error('No JSON in response')
      return JSON.parse(match[0])
    } catch {
      if (attempt === 3) return pairs.map(p => ({ key: p.key, value: p.source }))
      await new Promise(r => setTimeout(r, 2000 * attempt))
    }
  }
  return pairs.map(p => ({ key: p.key, value: p.source }))
}

async function fetchLocale(supabase: Supabase, locale: string) {
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

export async function POST() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()

  if (profile?.role !== 'hq') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  let totalFilled = 0

  // ── Step 1: Back-translate IT → EN for keys where EN is empty ──────────────
  const [enRows, itRows] = await Promise.all([
    fetchLocale(supabase, 'en'),
    fetchLocale(supabase, 'it'),
  ])

  const enMap = new Map(enRows.map(r => [r.key, r.value]))

  const needEn = itRows.filter(r =>
    !(enMap.get(r.key) ?? '').trim() && r.value.trim()
  )

  if (needEn.length > 0) {
    const toUpsert: { key: string; locale: string; value: string; updated_at: string }[] = []
    for (let i = 0; i < needEn.length; i += BATCH_SIZE) {
      const batch = needEn.slice(i, i + BATCH_SIZE)
      const translated = await translateBatch(
        batch.map(r => ({ key: r.key, source: r.value })),
        'it', 'en'
      )
      for (const t of translated) {
        toUpsert.push({ key: t.key, locale: 'en', value: t.value, updated_at: new Date().toISOString() })
        enMap.set(t.key, t.value)
      }
      await new Promise(r => setTimeout(r, 300))
    }
    await upsert(supabase, toUpsert)
    totalFilled += toUpsert.length
  }

  // ── Step 2: Translate EN → IT/ES/FR/DE for missing values ─────────────────
  const filledEn = [...enMap.entries()]
    .filter(([, v]) => v.trim())
    .map(([key, value]) => ({ key, value }))

  if (filledEn.length === 0) return NextResponse.json({ filled: totalFilled })

  for (const locale of LOCALES_TO_FILL) {
    const existing = await fetchLocale(supabase, locale)
    const existingMap = new Map(existing.map(r => [r.key, r.value]))
    const missing = filledEn.filter(k => !(existingMap.get(k.key) ?? '').trim())
    if (!missing.length) continue

    const toUpsert: { key: string; locale: string; value: string; updated_at: string }[] = []
    for (let i = 0; i < missing.length; i += BATCH_SIZE) {
      const batch = missing.slice(i, i + BATCH_SIZE)
      const translated = await translateBatch(
        batch.map(r => ({ key: r.key, source: r.value })),
        'en', locale
      )
      for (const t of translated) {
        toUpsert.push({ key: t.key, locale, value: t.value, updated_at: new Date().toISOString() })
      }
      await new Promise(r => setTimeout(r, 300))
    }
    await upsert(supabase, toUpsert)
    totalFilled += toUpsert.length
  }

  return NextResponse.json({ filled: totalFilled })
}
