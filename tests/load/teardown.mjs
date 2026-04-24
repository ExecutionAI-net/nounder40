#!/usr/bin/env node
/**
 * Cleans up the load-test fixtures created by seed.mjs.
 *
 * Removes:
 *   - bookings + attendance for the test lesson
 *   - the test lesson itself
 *   - student_packages granted to load-test users
 *   - school_students rows for load-test users
 *   - profiles + auth.users for loadtest+s${i}@alinaquintana.com
 *
 * Use:
 *   LOAD_LESSON_ID=<uuid> node tests/load/teardown.mjs
 *
 * Safe to re-run; missing rows are ignored.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

function loadDotEnv(file) {
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    if (process.env[m[1]]) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    process.env[m[1]] = v
  }
}

loadDotEnv(resolve(process.cwd(), '.env.local'))
loadDotEnv(resolve(process.cwd(), '.env'))

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const LESSON_ID = process.env.LOAD_LESSON_ID

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function listLoadtestUsers() {
  const out = []
  let page = 1
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    if (!data?.users?.length) break
    out.push(...data.users.filter((u) => u.email?.startsWith('loadtest+s') && u.email.endsWith('@alinaquintana.com')))
    if (data.users.length < 1000) break
    page += 1
  }
  return out
}

async function main() {
  if (LESSON_ID) {
    console.error(`Removing bookings + attendance for lesson ${LESSON_ID}...`)
    await admin.from('attendance').delete().eq('lesson_id', LESSON_ID)
    await admin.from('bookings').delete().eq('lesson_id', LESSON_ID)
    await admin.from('lessons').delete().eq('id', LESSON_ID)
  }

  const users = await listLoadtestUsers()
  console.error(`Found ${users.length} load-test users to remove.`)

  const ids = users.map((u) => u.id)
  if (ids.length) {
    await admin.from('student_packages').delete().in('student_id', ids)
    await admin.from('bookings').delete().in('student_id', ids)
    await admin.from('school_students').delete().in('student_id', ids)
    await admin.from('profiles').delete().in('id', ids)
    for (const id of ids) {
      const { error } = await admin.auth.admin.deleteUser(id)
      if (error) console.warn(`  delete ${id}: ${error.message}`)
    }
  }

  console.error('Teardown complete.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
