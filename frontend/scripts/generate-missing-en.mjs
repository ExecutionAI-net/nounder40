/**
 * generate-missing-en.mjs
 * Generates EN values from key names for keys that have NO translations at all.
 * Usage: node scripts/generate-missing-en.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const BATCH_SIZE = 80

async function askClaude(keys) {
  const prompt = `You are building a SaaS platform for classical dance schools called "No Under 40".
Given these translation key paths, generate natural English UI strings.
The key path gives context: e.g. "school.locations.addLocation" → "Add Location", "school.locations.subtitle" → "Manage your school locations and rooms".

Rules:
- Short, professional UI strings (buttons, labels, placeholders, messages)
- No quotes around the value
- Return ONLY a JSON array: [{"key":"...","value":"..."}]

Keys:
${JSON.stringify(keys, null, 2)}`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const text = data.content[0].text.trim()
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('No JSON in response')
  return JSON.parse(match[0])
}

async function run() {
  const { data: emptyKeys } = await sb
    .from('translations')
    .select('key')
    .eq('locale', 'en')
    .or('value.is.null,value.eq.')

  const keys = emptyKeys.map(r => r.key)
  console.log(`Generating EN values for ${keys.length} empty keys...`)

  const rows = []
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE)
    process.stdout.write(`  Batch ${Math.floor(i/BATCH_SIZE)+1}/${Math.ceil(keys.length/BATCH_SIZE)}... `)
    const result = await askClaude(batch)
    rows.push(...result.map(r => ({ key: r.key, locale: 'en', value: r.value, updated_at: new Date().toISOString() })))
    console.log(`✓ ${result.length}`)
    await new Promise(r => setTimeout(r, 300))
  }

  console.log(`Upserting ${rows.length} rows...`)
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await sb.from('translations').upsert(rows.slice(i, i + 100), { onConflict: 'key,locale' })
    if (error) console.error('❌', error.message)
    else console.log(`✅ batch ${Math.floor(i/100)+1}`)
  }
  console.log('🎉 Done!')
}

run().catch(e => { console.error(e); process.exit(1) })
