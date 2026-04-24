#!/usr/bin/env node
/**
 * Pre-seeds bookings for cancel-refund-race, then invokes k6.
 *
 * For each load-test student:
 *   - inserts a booking row directly via admin (status=confirmed)
 *   - increments lessons.current_bookings to keep the row consistent
 *
 * Uses the lesson identified by LOAD_LESSON_ID. The lesson must be
 * scheduled at least cancellation_policy_hours ahead so the cancel will
 * trigger a refund (seed.mjs creates it +1 day from now, default policy
 * is 24h — so this is borderline; bump LOAD_LESSON_OFFSET_DAYS=2 if
 * your school has a tighter policy).
 *
 * Runs the cancel-refund-race scenario, then prints post-conditions
 * (lessons.current_bookings + sum of credits refunded).
 */

import { spawnSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

function loadDotEnv(file) {
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m || process.env[m[1]]) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    process.env[m[1]] = v
  }
}
loadDotEnv(resolve(process.cwd(), '.env.local'))

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const LESSON_ID = process.env.LOAD_LESSON_ID
const STUDENT_COUNT = Number(process.env.LOAD_STUDENT_COUNT ?? 3)
const K6 = process.env.K6_BIN ?? 'k6'

if (!LESSON_ID) {
  console.error('LOAD_LESSON_ID required (run seed.mjs first)')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const studentEmail = (i) => `loadtest+s${i}@alinaquintana.com`

async function main() {
  console.error(`Pre-seeding bookings for lesson ${LESSON_ID}...`)

  const { data: lesson } = await admin
    .from('lessons')
    .select('id, school_id, max_capacity')
    .eq('id', LESSON_ID)
    .single()

  if (!lesson) throw new Error('Lesson not found')

  // Bump capacity so all VUs can be pre-booked (the scenario tests cancel,
  // not booking, so capacity is irrelevant for the race itself).
  await admin.from('lessons').update({ max_capacity: STUDENT_COUNT }).eq('id', LESSON_ID)

  const { data: { users } } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const loadtestUsers = users.filter((u) => u.email?.startsWith('loadtest+s') && u.email.endsWith('@alinaquintana.com'))

  const bookingIds = []
  for (let i = 0; i < STUDENT_COUNT; i++) {
    const email = studentEmail(i)
    const u = loadtestUsers.find((x) => x.email === email)
    if (!u) {
      console.warn(`  no user for ${email}, skipping`)
      continue
    }

    const { data: pkg } = await admin
      .from('student_packages')
      .select('id, credits_remaining')
      .eq('student_id', u.id)
      .eq('school_id', lesson.school_id)
      .eq('status', 'active')
      .order('purchased_at', { ascending: false })
      .limit(1)
      .single()

    if (!pkg) {
      console.warn(`  no package for ${email}, skipping`)
      continue
    }

    const { data: booking, error: bErr } = await admin
      .from('bookings')
      .insert({
        student_id: u.id,
        lesson_id: LESSON_ID,
        school_id: lesson.school_id,
        access_source: 'package',
        student_package_id: pkg.id,
        credits_deducted: 1,
        status: 'confirmed',
      })
      .select('id')
      .single()

    if (bErr) {
      console.warn(`  booking insert failed for ${email}: ${bErr.message}`)
      continue
    }
    bookingIds.push(booking.id)

    await admin
      .from('student_packages')
      .update({ credits_remaining: Math.max(0, pkg.credits_remaining - 1) })
      .eq('id', pkg.id)
  }

  await admin
    .from('lessons')
    .update({ current_bookings: bookingIds.length })
    .eq('id', LESSON_ID)

  console.error(`Seeded ${bookingIds.length} bookings.`)

  // Snapshot pre-state.
  const { data: preLesson } = await admin
    .from('lessons')
    .select('current_bookings')
    .eq('id', LESSON_ID)
    .single()

  console.error(`Pre-state: lessons.current_bookings = ${preLesson.current_bookings}`)

  // Run k6.
  const env = { ...process.env, LOAD_BOOKING_IDS: JSON.stringify(bookingIds) }
  const result = spawnSync(
    K6,
    [
      'run',
      '--summary-export=tests/load/results/cancel-race.json',
      'tests/load/scenarios/cancel-refund-race.js',
    ],
    { stdio: 'inherit', env },
  )

  // Post-state.
  const { data: postLesson } = await admin
    .from('lessons')
    .select('current_bookings')
    .eq('id', LESSON_ID)
    .single()

  const { data: postBookings } = await admin
    .from('bookings')
    .select('id, status, credit_refunded, cancellation_type')
    .in('id', bookingIds)

  const cancelled = postBookings.filter((b) => b.status === 'cancelled').length
  const refunded = postBookings.filter((b) => b.credit_refunded).length

  console.error('\n=== POST-RUN VERIFICATION ===')
  console.error(`  bookings cancelled        : ${cancelled} / ${bookingIds.length}`)
  console.error(`  bookings refunded         : ${refunded}`)
  console.error(`  current_bookings (post)   : ${postLesson.current_bookings} (expect 0)`)
  console.error('==============================\n')

  process.exit(result.status ?? 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
