/**
 * Journey 5 — HQ → School → Teacher onboarding cycle
 *
 * Covers the "paper trail" a new school leaves across the 3 panels:
 *
 *   HQ admin
 *     1. POST /api/hq/schools → creates a new school (initially inactive)
 *     2. GET /api/hq/schools → new school appears in the list
 *     3. PATCH /api/hq/schools/:id → activates the school + updates fee
 *
 *   School admin (our seeded school owner)
 *     4. POST /api/school/teachers → creates a new auth user, teachers row,
 *        teacher_schools link, and a profile with roles=['teacher']
 *     5. Duplicate teacher email → 400
 *
 * The teacher invite email is dispatched via ZeptoMail in production; in test
 * we stop short of clicking the invite link (that part needs a real inbox).
 * We verify the API created the right DB rows.
 */

import { test, expect, request as pwRequest } from '@playwright/test'
import path from 'node:path'
import { adminDb } from '../../helpers/db'

const HQ_AUTH = path.join(__dirname, '../../.auth/hq.json')
const SCHOOL_AUTH = path.join(__dirname, '../../.auth/school.json')

type HqCtx = { schoolId: string | null }
type TeacherCtx = { teacherId: string | null; teacherUserId: string | null; schoolId: string }

async function cleanupSchool(ctx: HqCtx) {
  if (!ctx.schoolId) return
  // Best-effort cascade — these tables have ON DELETE CASCADE on school_id,
  // but we also clear derived profile links so nothing stale survives.
  await adminDb.from('profiles').update({ school_id: null }).eq('school_id', ctx.schoolId)
  await adminDb.from('schools').delete().eq('id', ctx.schoolId)
}

async function cleanupTeacher(ctx: TeacherCtx) {
  if (ctx.teacherId) {
    await adminDb.from('teacher_schools').delete().eq('teacher_id', ctx.teacherId)
    await adminDb.from('teachers').delete().eq('id', ctx.teacherId)
  }
  if (ctx.teacherUserId) {
    await adminDb.from('profiles').delete().eq('id', ctx.teacherUserId)
    await adminDb.auth.admin.deleteUser(ctx.teacherUserId).catch(() => {})
  }
}

test.describe('Journey — HQ creates and manages a school', () => {
  const ctx: HqCtx = { schoolId: null }

  test.afterEach(async () => {
    await cleanupSchool(ctx)
    ctx.schoolId = null
  })

  test('HQ can create, activate, list, and update a school', async () => {
    const hq = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: HQ_AUTH,
    })

    const uniq = Date.now().toString(36)
    const schoolName = `e2e-school-${uniq}`
    const schoolEmail = `e2e-school-${uniq}@test.local`

    // 1. Create the school
    const createRes = await hq.post('/api/hq/schools', {
      data: {
        name: schoolName,
        email: schoolEmail,
        city: 'Milano',
        country: 'IT',
        platform_fee_percentage: '12',
        free_trial_days: '30',
      },
    })
    expect(createRes.ok()).toBe(true)
    const created = await createRes.json()
    expect(created.id).toBeTruthy()
    expect(created.name).toBe(schoolName)
    ctx.schoolId = created.id

    // 2. DB shows school as inactive with correct fee, trial, country
    const { data: row } = await adminDb
      .from('schools')
      .select('name, email, city, country, platform_fee_percentage, active, free_trial_ends_at, slug')
      .eq('id', ctx.schoolId!)
      .single()
    expect(row?.name).toBe(schoolName)
    expect(row?.email).toBe(schoolEmail)
    expect(row?.city).toBe('Milano')
    expect(row?.country).toBe('IT')
    expect(Number(row?.platform_fee_percentage)).toBe(12)
    expect(row?.active).toBe(false)       // freshly created schools are inactive
    expect(row?.free_trial_ends_at).toBeTruthy()
    expect(row?.slug).toMatch(new RegExp(`^e2e-school-${uniq}-\\d+$`))

    // 3. Listed in GET /api/hq/schools
    const listRes = await hq.get('/api/hq/schools')
    expect(listRes.ok()).toBe(true)
    const list = await listRes.json()
    const found = list.find((s: { id: string }) => s.id === ctx.schoolId)
    expect(found).toBeTruthy()
    expect(found.teacherCount).toBe(0)
    expect(found.studentCount).toBe(0)

    // 4. Activate + change fee via PATCH
    const patchRes = await hq.patch(`/api/hq/schools/${ctx.schoolId}`, {
      data: { active: true, platform_fee_percentage: 20 },
    })
    expect(patchRes.ok()).toBe(true)

    const { data: updated } = await adminDb
      .from('schools').select('active, platform_fee_percentage').eq('id', ctx.schoolId!).single()
    expect(updated?.active).toBe(true)
    expect(Number(updated?.platform_fee_percentage)).toBe(20)

    await hq.dispose()
  })

  test('creating a school without required fields returns 400', async () => {
    const hq = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: HQ_AUTH,
    })

    const res = await hq.post('/api/hq/schools', {
      data: { name: 'e2e-incomplete', email: '', city: '' },
    })
    expect(res.status()).toBe(400)

    await hq.dispose()
  })

  test('non-HQ user cannot create a school (403)', async () => {
    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })

    const res = await school.post('/api/hq/schools', {
      data: {
        name: `e2e-forbidden-${Date.now().toString(36)}`,
        email: `e2e-forbidden@test.local`,
        city: 'Milano',
      },
    })
    expect(res.status()).toBe(403)

    await school.dispose()
  })
})

test.describe('Journey — School admin invites a new teacher', () => {
  const ctx: TeacherCtx = { teacherId: null, teacherUserId: null, schoolId: '' }

  test.beforeAll(async () => {
    const { data: school } = await adminDb
      .from('schools').select('id').eq('slug', 'test-school').single()
    if (!school) throw new Error('test school missing')
    ctx.schoolId = school.id
  })

  test.afterEach(async () => {
    await cleanupTeacher(ctx)
    ctx.teacherId = null
    ctx.teacherUserId = null
  })

  test('creating a brand-new teacher seeds auth user + teachers + link + profile', async () => {
    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })

    const uniq = Date.now().toString(36)
    const teacherName = `e2e-teacher-${uniq}`
    const teacherEmail = `e2e-teacher-${uniq}@test.local`

    const res = await school.post('/api/school/teachers', {
      data: { name: teacherName, email: teacherEmail, phone: '+39 000 000 0000' },
    })
    expect(res.ok()).toBe(true)

    // teachers row
    const { data: teacher } = await adminDb
      .from('teachers')
      .select('id, user_id, name, email, school_id, active')
      .eq('email', teacherEmail)
      .single()
    expect(teacher?.name).toBe(teacherName)
    expect(teacher?.school_id).toBe(ctx.schoolId)
    expect(teacher?.active).toBe(true)
    ctx.teacherId = teacher!.id
    ctx.teacherUserId = teacher!.user_id

    // teacher_schools link
    const { data: link } = await adminDb
      .from('teacher_schools')
      .select('active')
      .eq('teacher_id', teacher!.id)
      .eq('school_id', ctx.schoolId)
      .single()
    expect(link?.active).toBe(true)

    // profile has teacher role tied to this school
    const { data: profile } = await adminDb
      .from('profiles')
      .select('role, roles, school_id, email')
      .eq('id', teacher!.user_id)
      .single()
    expect(profile?.email).toBe(teacherEmail)
    expect(profile?.roles).toEqual(expect.arrayContaining(['teacher']))
    expect(profile?.school_id).toBe(ctx.schoolId)

    // auth user created
    const { data: authUser } = await adminDb.auth.admin.getUserById(teacher!.user_id)
    expect(authUser?.user?.email).toBe(teacherEmail)

    await school.dispose()
  })

  test('inviting an already-linked teacher returns 400', async () => {
    // Seed: create a teacher first
    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })

    const uniq = Date.now().toString(36)
    const teacherEmail = `e2e-teacher-${uniq}@test.local`

    const first = await school.post('/api/school/teachers', {
      data: { name: `e2e-teacher-${uniq}`, email: teacherEmail },
    })
    expect(first.ok()).toBe(true)

    const { data: seeded } = await adminDb
      .from('teachers').select('id, user_id').eq('email', teacherEmail).single()
    ctx.teacherId = seeded!.id
    ctx.teacherUserId = seeded!.user_id

    // Now try to invite the same email again
    const dup = await school.post('/api/school/teachers', {
      data: { name: `e2e-teacher-${uniq}-dup`, email: teacherEmail },
    })
    expect(dup.status()).toBe(400)
    const body = await dup.json()
    expect(body.error).toMatch(/already linked/i)

    await school.dispose()
  })

  test('teacher invite requires name and email (400)', async () => {
    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })

    const res = await school.post('/api/school/teachers', {
      data: { name: '', email: '' },
    })
    expect(res.status()).toBe(400)

    await school.dispose()
  })
})
