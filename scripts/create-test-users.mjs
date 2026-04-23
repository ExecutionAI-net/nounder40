#!/usr/bin/env node
/**
 * Create test users for Playwright e2e tests.
 *
 * Uses Supabase Admin API to create auth.users properly, then sets up profiles
 * and role-specific records (school, students) via the REST API.
 *
 * Usage:  node scripts/create-test-users.mjs
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment.
 */

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const PASSWORD = 'Aa123456+'

const USERS = [
  { email: 'support+hq@alinaquintana.com', role: 'hq', name: 'Test HQ', hq_sub_role: 'super_admin' },
  { email: 'support+school@alinaquintana.com', role: 'school', name: 'Test School Admin', school_sub_role: 'owner' },
  { email: 'support+teacher@alinaquintana.com', role: 'teacher', name: 'Test Teacher' },
  { email: 'support+student@alinaquintana.com', role: 'student', name: 'Test Student' },
]

async function findUserByEmail(email) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) throw error
  return data.users.find(u => u.email === email)
}

async function createOrGetAuthUser(u) {
  const existing = await findUserByEmail(u.email)
  if (existing) {
    console.log(`  ↻  ${u.email} exists (id: ${existing.id.slice(0, 8)}…)`)
    // Reset password to known value
    const { error } = await admin.auth.admin.updateUserById(existing.id, { password: PASSWORD })
    if (error) console.warn(`    password reset failed: ${error.message}`)
    return existing.id
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: u.email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { name: u.name },
  })
  if (error) throw new Error(`createUser(${u.email}): ${error.message}`)
  console.log(`  ✓  created ${u.email} (id: ${data.user.id.slice(0, 8)}…)`)
  return data.user.id
}

async function ensureTestSchool() {
  const { data: existing } = await admin
    .from('schools')
    .select('id')
    .eq('slug', 'test-school')
    .maybeSingle()

  if (existing) return existing.id

  const { data, error } = await admin
    .from('schools')
    .insert({
      name: 'Test School',
      slug: 'test-school',
      email: 'support+school@alinaquintana.com',
      city: 'Milan',
      country: 'IT',
      active: true,
      platform_fee_percentage: 10,
    })
    .select('id')
    .single()
  if (error) throw new Error(`school create: ${error.message}`)
  return data.id
}

async function upsertProfile(userId, u, schoolId) {
  const row = {
    id: userId,
    email: u.email,
    name: u.name,
    role: u.role,
    roles: [u.role],
  }
  if (u.hq_sub_role) row.hq_sub_role = u.hq_sub_role
  if (u.role === 'school' && schoolId) {
    row.school_id = schoolId
    row.school_sub_role = u.school_sub_role ?? 'owner'
  }

  const { error } = await admin.from('profiles').upsert(row, { onConflict: 'id' })
  if (error) throw new Error(`profile upsert ${u.email}: ${error.message}`)
}

async function ensureStudentRecord(userId, u) {
  if (u.role !== 'student') return
  const { data: existing } = await admin
    .from('students')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()
  if (existing) return

  const { error } = await admin.from('students').insert({
    user_id: userId,
    name: u.name,
    email: u.email,
  })
  if (error) console.warn(`  students insert ${u.email}: ${error.message}`)
}

async function ensureTeacherRecord(userId, u, schoolId) {
  if (u.role !== 'teacher') return
  const { data: existing } = await admin
    .from('teachers')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()
  if (existing) return

  const { error } = await admin.from('teachers').insert({
    user_id: userId,
    school_id: schoolId,
    name: u.name,
    email: u.email,
    active: true,
  })
  if (error) console.warn(`  teachers insert ${u.email}: ${error.message}`)
}

async function main() {
  console.log(`\nCreating test users at ${url}\n`)

  const schoolId = await ensureTestSchool()
  console.log(`  school_id: ${schoolId.slice(0, 8)}…\n`)

  for (const u of USERS) {
    const userId = await createOrGetAuthUser(u)
    await upsertProfile(userId, u, schoolId)
    await ensureStudentRecord(userId, u)
    await ensureTeacherRecord(userId, u, schoolId)
  }

  console.log('\n✅  Test users ready. Password: Aa123456+')
}

main().catch(e => {
  console.error('\n❌  Error:', e.message)
  process.exit(1)
})
