#!/usr/bin/env node
/**
 * Test data cleanup runner.
 *
 * Usage:
 *   node scripts/cleanup.mjs soft       → L1: remove e2e courses/bookings/lessons
 *   node scripts/cleanup.mjs testdata   → L2: remove all e2e-prefixed rows
 *   node scripts/cleanup.mjs nuke       → L3: remove all test data + test auth users
 *
 * Expects NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment.
 * Run via: npm run test:cleanup (L2) | test:cleanup:soft (L1) | test:cleanup:nuke (L3)
 */

import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const level = process.argv[2] ?? 'testdata'

const SQL_FILES = {
  soft: join(__dirname, '../tests/sql/cleanup_L1_soft.sql'),
  testdata: join(__dirname, '../tests/sql/cleanup_L2_testdata.sql'),
  nuke: join(__dirname, '../tests/sql/cleanup_L3_nuke.sql'),
}

if (!SQL_FILES[level]) {
  console.error(`Unknown cleanup level: ${level}. Use: soft | testdata | nuke`)
  process.exit(1)
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

if (level === 'nuke') {
  console.warn('\n⚠️  NUKE mode: This will delete all test users.')
  console.warn('   After this, re-run create_test_users.sql and npm run test:e2e.\n')
}

const db = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const sql = readFileSync(SQL_FILES[level], 'utf8')

// Split on statement boundaries and run each non-empty statement
const statements = sql
  .split(/;\s*\n/)
  .map(s => s.trim())
  .filter(s => s.length > 0 && !s.startsWith('--'))

console.log(`Running L${level === 'soft' ? 1 : level === 'testdata' ? 2 : 3} cleanup (${statements.length} statements)...`)

let ok = 0
let fail = 0

for (const stmt of statements) {
  const { error } = await db.rpc('exec_sql', { sql: stmt }).catch(() => ({ error: { message: 'rpc unavailable' } }))

  // Supabase JS doesn't expose raw SQL exec — use the REST SQL endpoint instead
  const res = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql: stmt }),
  })

  if (!res.ok) {
    // Many projects don't expose exec_sql — fall back to Supabase Management API
    // Just report and continue; user can run SQL manually if needed
    const body = await res.text()
    console.warn(`  ⚠  Statement skipped (exec_sql not available): ${stmt.slice(0, 60)}...`)
    console.warn(`     Tip: run ${SQL_FILES[level]} directly in Supabase SQL Editor.`)
    fail++
    break
  }

  ok++
}

if (fail === 0) {
  console.log(`✅  Cleanup complete (${ok} statements executed).`)
} else {
  console.log(`\nManual fallback: open Supabase SQL Editor and run:`)
  console.log(`  ${SQL_FILES[level]}\n`)
}
