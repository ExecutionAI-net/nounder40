/**
 * fix-missing-en.mjs
 * Back-translates IT → EN for keys where EN is empty but IT has a value.
 * Usage: node scripts/fix-missing-en.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const BATCH_SIZE = 50

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

async function fetchAll(locale) {
  let all = [], offset = 0
  while (true) {
    const { data } = await sb.from('translations').select('key, value').eq('locale', locale).range(offset, offset + 999)
    if (!data?.length) break
    all = all.concat(data)
    if (data.length < 1000) break
    offset += 1000
  }
  return all
}

async function translateBatch(pairs, fromLocale, toLocale) {
  const names = { en: 'English', it: 'Italian', es: 'Spanish', fr: 'French', de: 'German' }
  const prompt = `You are a professional translator for a dance school SaaS platform "No Under 40".
Translate from ${names[fromLocale]} to ${names[toLocale]}.
Rules: keep {placeholders}, emojis, proper nouns (No Under 40, Stripe, HQ, etc.) as-is.
Return ONLY a JSON array: [{"key":"...","value":"..."}]

Input:
${JSON.stringify(pairs, null, 2)}`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 8096, messages: [{ role: 'user', content: prompt }] }),
  })
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const text = data.content[0].text.trim()
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('No JSON in response')
  return JSON.parse(match[0])
}

async function run() {
  console.log('Fetching EN and IT rows...')
  const [enRows, itRows] = await Promise.all([fetchAll('en'), fetchAll('it')])
  const enMap = new Map(enRows.map(r => [r.key, r.value]))

  const needEn = itRows.filter(r => !(enMap.get(r.key) ?? '').trim() && r.value.trim())
  console.log(`Found ${needEn.length} keys with empty EN but filled IT`)

  if (!needEn.length) { console.log('Nothing to do!'); return }

  const totalBatches = Math.ceil(needEn.length / BATCH_SIZE)
  const rows = []

  for (let i = 0; i < needEn.length; i += BATCH_SIZE) {
    const batch = needEn.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    process.stdout.write(`  Batch ${batchNum}/${totalBatches}... `)

    let translated
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        translated = await translateBatch(batch.map(r => ({ key: r.key, source: r.value })), 'it', 'en')
        break
      } catch (e) {
        console.log(`\n  ⚠ Attempt ${attempt}/3: ${e.message}`)
        if (attempt === 3) translated = batch.map(r => ({ key: r.key, value: r.value }))
        else await new Promise(r => setTimeout(r, 2000 * attempt))
      }
    }

    rows.push(...translated.map(t => ({ key: t.key, locale: 'en', value: t.value, updated_at: new Date().toISOString() })))
    console.log(`✓ ${translated.length}`)
    await new Promise(r => setTimeout(r, 300))
  }

  console.log(`\nUpserting ${rows.length} EN rows to Supabase...`)
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await sb.from('translations').upsert(rows.slice(i, i + 100), { onConflict: 'key,locale' })
    if (error) console.error('  ❌', error.message)
    else process.stdout.write(`  ✅ batch ${Math.floor(i/100)+1}\n`)
  }
  console.log('\n🎉 Done!')
}

run().catch(e => { console.error(e); process.exit(1) })
