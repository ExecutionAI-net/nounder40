#!/usr/bin/env node
/**
 * Seed load-test data via Supabase Admin API.
 *
 * Creates:
 *   - N test students (loadtest+s${i}@alinaquintana.com), confirmed, password = LoadTest123!
 *   - profile rows with role 'student'
 *   - school_students rows binding each student to the LOAD_SCHOOL_ID
 *   - one fresh test lesson on LOAD_COURSE_ID dated +1 day
 *
 * Outputs LOAD_LESSON_ID and the student count to stdout so the runner can
 * pipe them into k6 via env vars.
 *
 * Required env (in .env.local or shell):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   LOAD_SCHOOL_ID
 *   LOAD_COURSE_ID
 *
 * Optional:
 *   LOAD_STUDENT_COUNT (default 20)
 *   LOAD_LESSON_CAPACITY (default 5 — keeps booking-race meaningful)
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

function loadDotEnv(file) {
  if (!existsSync(file)) return
  const content = readFileSync(file, 'utf8')
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    const [, k, raw] = m
    if (process.env[k]) continue
    let v = raw.trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    process.env[k] = v
  }
}

loadDotEnv(resolve(process.cwd(), '.env.local'))
loadDotEnv(resolve(process.cwd(), '.env'))

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SCHOOL_ID = process.env.LOAD_SCHOOL_ID
const COURSE_ID = process.env.LOAD_COURSE_ID
const STUDENT_COUNT = Number(process.env.LOAD_STUDENT_COUNT ?? 20)
const LESSON_CAPACITY = Number(process.env.LOAD_LESSON_CAPACITY ?? 5)
const PASSWORD = 'LoadTest123!'

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
if (!SCHOOL_ID || !COURSE_ID) {
  console.error('Missing LOAD_SCHOOL_ID or LOAD_COURSE_ID')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const studentEmail = (i) => `loadtest+s${i}@alinaquintana.com`

async function ensureStudent(i) {
  const email = studentEmail(i)

  const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const found = existing?.users?.find((u) => u.email === email)

  let userId = found?.id
  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { name: `Load Test ${i}`, loadtest: true },
    })
    if (error) throw new Error(`createUser ${email}: ${error.message}`)
    userId = data.user.id
  } else {
    await admin.auth.admin.updateUserById(userId, { password: PASSWORD, email_confirm: true })
  }

  await admin.from('profiles').upsert(
    {
      id: userId,
      email,
      name: `Load Test ${i}`,
      role: 'student',
      roles: ['student'],
    },
    { onConflict: 'id' },
  )

  await admin.from('school_students').upsert(
    { school_id: SCHOOL_ID, student_id: userId, free_lesson_used: true },
    { onConflict: 'school_id,student_id' },
  )

  return userId
}

async function createTestLesson() {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const date = tomorrow.toISOString().slice(0, 10)

  const { data: course, error: courseErr } = await admin
    .from('courses')
    .select('id, school_id, lesson_type_id, teacher_id, room_id, start_time, duration_minutes, credit_cost')
    .eq('id', COURSE_ID)
    .single()
  if (courseErr) throw new Error(`fetch course: ${courseErr.message}`)

  const startTime = course.start_time ?? '18:00:00'
  const durationMinutes = course.duration_minutes ?? 60
  const [h, m] = startTime.split(':').map(Number)
  const endMinutes = h * 60 + m + durationMinutes
  const endTime = `${String(Math.floor(endMinutes / 60) % 24).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}:00`

  const { data: lesson, error: lessonErr } = await admin
    .from('lessons')
    .insert({
      course_id: course.id,
      school_id: course.school_id,
      teacher_id: course.teacher_id,
      room_id: course.room_id,
      lesson_type_id: course.lesson_type_id,
      date,
      start_time: startTime,
      end_time: endTime,
      max_capacity: LESSON_CAPACITY,
      current_bookings: 0,
      status: 'scheduled',
    })
    .select('id')
    .single()
  if (lessonErr) throw new Error(`insert lesson: ${lessonErr.message}`)

  return lesson.id
}

async function grantCreditsToAll(studentIds) {
  const { data: pkg } = await admin
    .from('packages')
    .select('id, credits, validity_days')
    .eq('school_id', SCHOOL_ID)
    .eq('active', true)
    .limit(1)
    .single()

  if (!pkg) {
    console.warn('No active package found — skipping credit grant. Make sure students have credits via subscription or package.')
    return
  }

  const now = new Date()
  const expires = new Date(now.getTime() + (pkg.validity_days ?? 365) * 86400000)

  const rows = studentIds.map((sid) => ({
    student_id: sid,
    school_id: SCHOOL_ID,
    package_id: pkg.id,
    credits_total: pkg.credits ?? 100,
    credits_remaining: pkg.credits ?? 100,
    purchased_at: now.toISOString(),
    expires_at: expires.toISOString(),
    payment_method: 'cash',
    status: 'active',
  }))

  const { error } = await admin.from('student_packages').insert(rows)
  if (error) console.warn(`grant credits: ${error.message}`)
}

async function main() {
  console.error(`Seeding ${STUDENT_COUNT} students for school ${SCHOOL_ID}...`)
  const ids = []
  for (let i = 0; i < STUDENT_COUNT; i++) {
    const id = await ensureStudent(i)
    ids.push(id)
    if ((i + 1) % 10 === 0) console.error(`  ${i + 1}/${STUDENT_COUNT}`)
  }

  await grantCreditsToAll(ids)

  const lessonId = await createTestLesson()
  console.error(`Lesson ${lessonId} created (capacity ${LESSON_CAPACITY}).`)

  const out = {
    LOAD_LESSON_ID: lessonId,
    LOAD_STUDENT_COUNT: STUDENT_COUNT,
    LOAD_LESSON_CAPACITY: LESSON_CAPACITY,
  }
  console.log(JSON.stringify(out, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
