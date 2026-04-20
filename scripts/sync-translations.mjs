/**
 * sync-translations.mjs
 *
 * Scans all .tsx/.ts files under src/ for useTranslations('namespace') + t('key') calls,
 * builds fully-qualified keys like "namespace.key" (e.g. "layout.signOut"),
 * then upserts any missing keys into the Supabase translations table
 * with empty values for all 5 locales (en, it, es, fr, de).
 *
 * Also handles bare t('key') calls in files without a useTranslations namespace.
 *
 * Usage: npm run sync-translations
 *
 * After running, go to HQ > Translations to fill in the translations.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, readdirSync } from 'fs'
import { join, extname } from 'path'
import { config } from 'dotenv'

// Load env vars
config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const LOCALES = ['en', 'it', 'es', 'fr', 'de']
const SRC_DIR = join(process.cwd(), 'src')

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

// Recursively collect all .ts/.tsx files
function collectFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', '.next', 'scripts'].includes(entry.name)) continue
      files.push(...collectFiles(fullPath))
    } else if (['.ts', '.tsx'].includes(extname(entry.name))) {
      files.push(fullPath)
    }
  }
  return files
}

/**
 * Extract fully-qualified translation keys from a file.
 *
 * Strategy:
 * 1. Find all `const <varName> = useTranslations('<namespace>')` declarations
 *    → builds a map: varName → namespace
 * 2. Find all `<varName>('<key>')` calls and emit `namespace.key`
 * 3. Also catch bare `t('<key>')` that have no namespace (rare, kept for compatibility)
 */
function extractKeys(content) {
  const keys = new Set()

  // Step 1: Find useTranslations / getTranslations declarations
  // Matches: const t = useTranslations('layout')
  //          const tNav = useTranslations('nav.teacher')
  //          const t = await getTranslations('student.dashboard')
  const nsMap = new Map() // varName → namespace
  const nsRe = /const\s+(\w+)\s*=\s*(?:await\s+)?(?:use|get)Translations\(\s*['"`]([^'"`]*)['"`]\s*\)/g
  let m
  while ((m = nsRe.exec(content)) !== null) {
    nsMap.set(m[1], m[2])
  }

  // Step 2: For each known var, find all its t('key') calls
  for (const [varName, ns] of nsMap) {
    // Escape varName for regex (typically just alphanumeric + _)
    const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Match varName('key') or varName('key', { ... }) — allow optional second arg
    const callRe = new RegExp(`\\b${escaped}\\(\\s*['"\`]([^'"\`]+)['"\`]\\s*[,)]`, 'g')
    while ((m = callRe.exec(content)) !== null) {
      const rawKey = m[1]
      // Skip keys that look like pluralization placeholders (e.g. {count})
      if (rawKey.includes('{')) continue
      const fullKey = ns ? `${ns}.${rawKey}` : rawKey
      keys.add(fullKey)
    }
  }

  // Step 3: Also find t('key') calls in files with NO useTranslations (e.g. server components using getTranslations)
  // Only do this if no nsMap entries were found for 't', to avoid double-counting
  if (!nsMap.has('t')) {
    const bareRe = /\bt\(\s*['"`]([^'"`]+)['"`]\s*\)/g
    while ((m = bareRe.exec(content)) !== null) {
      const rawKey = m[1]
      if (rawKey.includes('{')) continue
      keys.add(rawKey)
    }
  }

  return keys
}

async function main() {
  console.log('🔍 Scanning src/ for translation keys...')
  const files = collectFiles(SRC_DIR)

  const allKeys = new Set()
  for (const file of files) {
    const content = readFileSync(file, 'utf-8')
    const keys = extractKeys(content)
    keys.forEach(k => allKeys.add(k))
  }

  console.log(`📝 Found ${allKeys.size} unique translation keys in ${files.length} files`)

  // Fetch existing keys from DB
  const { data: existing, error: fetchErr } = await supabase
    .from('translations')
    .select('key, locale')

  if (fetchErr) {
    console.error('❌ Failed to fetch existing translations:', fetchErr.message)
    process.exit(1)
  }

  const existingSet = new Set((existing ?? []).map(r => `${r.key}|${r.locale}`))

  // Find missing key+locale combinations
  const toInsert = []
  for (const key of allKeys) {
    for (const locale of LOCALES) {
      if (!existingSet.has(`${key}|${locale}`)) {
        toInsert.push({ key, locale, value: '' })
      }
    }
  }

  if (toInsert.length === 0) {
    console.log('✅ All keys are already in the database. Nothing to sync.')
    return
  }

  console.log(`➕ Inserting ${toInsert.length} missing key+locale rows...`)

  // Insert in batches of 100
  const BATCH = 100
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH)
    const { error } = await supabase
      .from('translations')
      .upsert(batch, { onConflict: 'key,locale', ignoreDuplicates: true })
    if (error) {
      console.error('❌ Insert error:', error.message)
      process.exit(1)
    }
  }

  const newKeys = new Set(toInsert.map(r => r.key))
  console.log(`\n✅ Synced ${newKeys.size} new keys (${toInsert.length} rows across ${LOCALES.length} locales):`)
  for (const k of [...newKeys].sort()) console.log(`   • ${k}`)
  console.log('\n👉 Go to HQ > Translations to add the translations.')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
