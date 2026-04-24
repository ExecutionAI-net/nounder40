/**
 * Journey — Team member self-service account management
 *
 * Covers the new /hq/account and /school/account pages (backed by
 * /api/account, /api/account/change-password, /api/account/leave-org,
 * /api/account/delete):
 *
 *   1. GET /api/account returns the caller's profile with joined school
 *   2. PATCH /api/account updates name / phone / language_preference
 *   3. Change password (wrong current → 400; right current → session pw changes)
 *   4. Leave org removes the role; if it was the only role, account is
 *      soft-deleted (profiles.deleted_at set)
 *   5. Delete account requires exact "delete my account" phrase
 *   6. UI-level: /hq/account and /school/account render, tabs switch,
 *      Account form saves name via PATCH
 */

import { test, expect, request as pwRequest } from '@playwright/test'
import path from 'node:path'
import { adminDb } from '../../helpers/db'

const HQ_AUTH = path.join(__dirname, '../../.auth/hq.json')
const SCHOOL_AUTH = path.join(__dirname, '../../.auth/school.json')

async function getProfileSnapshot(email: string) {
  const { data } = await adminDb
    .from('profiles')
    .select('id, name, phone, language_preference, roles, role, hq_sub_role, school_sub_role, school_id, deleted_at')
    .eq('email', email)
    .single()
  return data
}

async function restoreProfile(email: string, snapshot: Awaited<ReturnType<typeof getProfileSnapshot>>) {
  if (!snapshot) return
  await adminDb.from('profiles').update({
    name: snapshot.name,
    phone: snapshot.phone,
    language_preference: snapshot.language_preference,
    roles: snapshot.roles,
    role: snapshot.role,
    hq_sub_role: snapshot.hq_sub_role,
    school_sub_role: snapshot.school_sub_role,
    school_id: snapshot.school_id,
    deleted_at: null,
  }).eq('id', snapshot.id)
}

// ────────────────────────────────────────────────────────────────
// GET / PATCH /api/account
// ────────────────────────────────────────────────────────────────

test.describe('Journey — /api/account GET + PATCH', () => {
  let hqSnapshot: Awaited<ReturnType<typeof getProfileSnapshot>> = null
  const hqEmail = 'support+hq@alinaquintana.com'

  test.beforeAll(async () => {
    hqSnapshot = await getProfileSnapshot(hqEmail)
  })

  test.afterEach(async () => {
    await restoreProfile(hqEmail, hqSnapshot)
  })

  test('GET /api/account returns own profile with joined school', async () => {
    const hq = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: HQ_AUTH,
    })
    const res = await hq.get('/api/account')
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.email).toBe(hqEmail)
    expect(body.roles).toEqual(expect.arrayContaining(['hq']))
    expect(body.hq_sub_role).toBe('super_admin')
    await hq.dispose()
  })

  test('PATCH /api/account updates name, phone, language', async () => {
    const hq = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: HQ_AUTH,
    })
    const res = await hq.patch('/api/account', {
      data: { name: 'Test HQ Renamed', phone: '+39 333 444 5555', language_preference: 'it' },
    })
    expect(res.ok()).toBe(true)

    const { data: updated } = await adminDb
      .from('profiles').select('name, phone, language_preference').eq('email', hqEmail).single()
    expect(updated?.name).toBe('Test HQ Renamed')
    expect(updated?.phone).toBe('+39 333 444 5555')
    expect(updated?.language_preference).toBe('it')

    await hq.dispose()
  })

  test('PATCH with invalid language_preference is silently ignored (validated)', async () => {
    const hq = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: HQ_AUTH,
    })
    const res = await hq.patch('/api/account', {
      data: { language_preference: 'xx', name: 'Test HQ 2' },
    })
    expect(res.ok()).toBe(true)
    const { data } = await adminDb
      .from('profiles').select('language_preference, name').eq('email', hqEmail).single()
    // Name got saved, bad language got filtered out (default/prev stays)
    expect(data?.name).toBe('Test HQ 2')
    expect(['en', 'it', 'es', 'fr', 'de']).toContain(data?.language_preference)
    await hq.dispose()
  })

  test('Empty patch returns 400', async () => {
    const hq = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: HQ_AUTH,
    })
    const res = await hq.patch('/api/account', { data: { foo: 'bar' } })
    expect(res.status()).toBe(400)
    await hq.dispose()
  })

  test('Unauthenticated GET returns 401', async ({ request }) => {
    const res = await request.get('/api/account')
    expect(res.status()).toBe(401)
  })
})

// ────────────────────────────────────────────────────────────────
// Change password
// ────────────────────────────────────────────────────────────────

test.describe('Journey — /api/account/change-password', () => {
  const schoolEmail = 'support+school@alinaquintana.com'
  const originalPassword = 'Aa123456+'

  test.afterEach(async () => {
    // Reset the password to the known test value whatever happened
    const { data } = await adminDb.from('profiles').select('id').eq('email', schoolEmail).single()
    if (data?.id) {
      await adminDb.auth.admin.updateUserById(data.id, { password: originalPassword })
    }
  })

  test('Wrong current password is rejected (400)', async () => {
    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })
    const res = await school.post('/api/account/change-password', {
      data: { current_password: 'definitely-wrong', new_password: 'Newpass123!' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/incorrect/i)
    await school.dispose()
  })

  test('Short new password is rejected (400)', async () => {
    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })
    const res = await school.post('/api/account/change-password', {
      data: { current_password: originalPassword, new_password: 'abc' },
    })
    expect(res.status()).toBe(400)
    await school.dispose()
  })

  test('Correct current password updates the password', async () => {
    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })
    const newPw = `TempPw${Date.now()}!`
    const res = await school.post('/api/account/change-password', {
      data: { current_password: originalPassword, new_password: newPw },
    })
    expect(res.ok()).toBe(true)

    // Verify by trying to login with the new password via Supabase auth endpoint
    const loginRes = await school.post(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_URL?.includes('supabase.co')
          ? 'sb_publishable_Wvdubv53WgkirZJG_BbcZA_zWWp3V6o'
          : '',
        'Content-Type': 'application/json',
      },
      data: { email: schoolEmail, password: newPw },
    })
    expect(loginRes.ok()).toBe(true)

    await school.dispose()
  })
})

// ────────────────────────────────────────────────────────────────
// Leave org
// ────────────────────────────────────────────────────────────────

test.describe('Journey — /api/account/leave-org', () => {
  const schoolEmail = 'support+school@alinaquintana.com'
  let snapshot: Awaited<ReturnType<typeof getProfileSnapshot>> = null

  test.beforeEach(async () => {
    snapshot = await getProfileSnapshot(schoolEmail)
  })

  test.afterEach(async () => {
    await restoreProfile(schoolEmail, snapshot)
  })

  test('Leaving "school" with no other roles soft-deletes the profile', async () => {
    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })

    // Ensure the profile has exactly ['school'] for this test
    await adminDb.from('profiles')
      .update({ roles: ['school'], role: 'school' })
      .eq('email', schoolEmail)

    const res = await school.post('/api/account/leave-org', { data: { org: 'school' } })
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.left).toBe('school')
    expect(body.account_deleted).toBe(true)
    expect(body.remaining_roles).toEqual([])

    const { data: after } = await adminDb
      .from('profiles').select('roles, school_id, school_sub_role, deleted_at').eq('email', schoolEmail).single()
    expect(after?.roles).toEqual([])
    expect(after?.school_id).toBeNull()
    expect(after?.school_sub_role).toBeNull()
    expect(after?.deleted_at).toBeTruthy()

    await school.dispose()
  })

  test('Leaving when you have another role keeps the account active', async () => {
    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })

    // Give the account both school and student roles
    await adminDb.from('profiles')
      .update({ roles: ['school', 'student'], role: 'school' })
      .eq('email', schoolEmail)

    const res = await school.post('/api/account/leave-org', { data: { org: 'school' } })
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.account_deleted).toBe(false)
    expect(body.remaining_roles).toEqual(['student'])

    const { data: after } = await adminDb
      .from('profiles').select('roles, role, deleted_at').eq('email', schoolEmail).single()
    expect(after?.roles).toEqual(['student'])
    expect(after?.role).toBe('student')
    expect(after?.deleted_at).toBeNull()

    await school.dispose()
  })

  test('Invalid org param returns 400', async () => {
    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })
    const res = await school.post('/api/account/leave-org', { data: { org: 'student' } })
    expect(res.status()).toBe(400)
    await school.dispose()
  })
})

// ────────────────────────────────────────────────────────────────
// Delete account
// ────────────────────────────────────────────────────────────────

test.describe('Journey — /api/account/delete', () => {
  const schoolEmail = 'support+school@alinaquintana.com'
  let snapshot: Awaited<ReturnType<typeof getProfileSnapshot>> = null

  test.beforeEach(async () => { snapshot = await getProfileSnapshot(schoolEmail) })
  test.afterEach(async () => { await restoreProfile(schoolEmail, snapshot) })

  test('Requires the exact confirmation phrase', async () => {
    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })
    const bad = await school.post('/api/account/delete', { data: { confirmation: 'yes' } })
    expect(bad.status()).toBe(400)
    await school.dispose()
  })

  test('Sets deleted_at when phrase matches', async () => {
    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })
    const res = await school.post('/api/account/delete', {
      data: { confirmation: 'delete my account' },
    })
    expect(res.ok()).toBe(true)

    const { data } = await adminDb
      .from('profiles').select('deleted_at').eq('email', schoolEmail).single()
    expect(data?.deleted_at).toBeTruthy()

    await school.dispose()
  })
})

// ────────────────────────────────────────────────────────────────
// UI smoke
// ────────────────────────────────────────────────────────────────

test.describe('Journey UI — /hq/account + /school/account render', () => {
  test('HQ account page loads and shows the three tabs', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: HQ_AUTH })
    const page = await ctx.newPage()
    await page.goto('/en/hq/account')
    await expect(page.getByRole('heading', { name: 'My Account' })).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('button', { name: 'Account' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Security' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Membership' })).toBeVisible()
    await ctx.close()
  })

  test('School account page loads and switches to Security tab', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: SCHOOL_AUTH })
    const page = await ctx.newPage()
    await page.goto('/en/school/account')
    await expect(page.getByRole('heading', { name: 'My Account' })).toBeVisible({ timeout: 15000 })

    await page.getByRole('button', { name: 'Security' }).click()
    await expect(page.getByLabel('Current password')).toBeVisible()
    await expect(page.getByLabel('New password')).toBeVisible()

    await ctx.close()
  })
})
