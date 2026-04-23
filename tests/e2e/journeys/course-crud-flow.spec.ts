/**
 * Journey 14 — Course CRUD lifecycle via API
 *
 * Covers the full course lifecycle that backs the 4-step wizard UI:
 *   1. Create (POST /api/school/courses) with a single-schedule payload →
 *      a `courses` row + generated `lessons` row (single frequency)
 *   2. Read (GET /api/school/courses/:id) returns the course plus its lessons
 *   3. Update (PUT /api/school/courses/:id) patches course fields
 *   4. Delete (DELETE /api/school/courses/:id) removes course + lessons
 *
 * Plus validation + authorization edges.
 */

import { test, expect, request as pwRequest } from '@playwright/test'
import path from 'node:path'
import { adminDb } from '../../helpers/db'
import { createLessonType, inDays } from '../../fixtures/factory'

type Ctx = {
  schoolId: string
  lessonTypeId: string
  createdCourseIds: string[]
}

const SCHOOL_AUTH = path.join(__dirname, '../../.auth/school.json')
const HQ_AUTH = path.join(__dirname, '../../.auth/hq.json')

async function seed(): Promise<Ctx> {
  const { data: school } = await adminDb
    .from('schools').select('id').eq('slug', 'test-school').single()
  if (!school) throw new Error('test school missing')
  const lessonType = await createLessonType()
  return { schoolId: school.id, lessonTypeId: lessonType.id, createdCourseIds: [] }
}

async function cleanup(ctx: Ctx) {
  for (const courseId of ctx.createdCourseIds) {
    await adminDb.from('bookings').delete().eq('course_id', courseId)
    await adminDb.from('lessons').delete().eq('course_id', courseId)
    await adminDb.from('courses').delete().eq('id', courseId)
  }
  if (ctx.lessonTypeId) {
    await adminDb.from('lesson_types').delete().eq('id', ctx.lessonTypeId)
  }
}

test.describe('Journey — Course CRUD', () => {
  let ctx: Ctx

  test.beforeEach(async () => {
    ctx = await seed()
  })

  test.afterEach(async () => {
    await cleanup(ctx)
  })

  test('create → read → update → delete a single-schedule course', async () => {
    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })

    const uniq = Date.now().toString(36)
    const courseName = `e2e-course-${uniq}`

    // 1. CREATE — single-lesson course dated 3 days from now
    const createRes = await school.post('/api/school/courses', {
      data: {
        lesson_type_id: ctx.lessonTypeId,
        name: courseName,
        description: 'e2e description',
        frequency: 'single',
        start_date: inDays(3),
        start_time: '10:00',
        duration_minutes: 60,
        max_capacity: 10,
        credit_cost: 1,
        min_booking_notice_hours: 2,
        vip_booking_hours_before: 0,
        waitlist_enabled: false,
      },
    })
    expect(createRes.ok()).toBe(true)
    const created = await createRes.json()
    expect(created.id).toBeTruthy()
    expect(Number(created.lessons_created)).toBe(1)
    ctx.createdCourseIds.push(created.id)

    // Course row exists with the right school_id
    const { data: course } = await adminDb
      .from('courses').select('name, school_id, lesson_type_id, max_capacity').eq('id', created.id).single()
    expect(course?.name).toBe(courseName)
    expect(course?.school_id).toBe(ctx.schoolId)
    expect(course?.lesson_type_id).toBe(ctx.lessonTypeId)
    expect(course?.max_capacity).toBe(10)

    // Lesson was generated
    const { data: lessons } = await adminDb
      .from('lessons').select('id, date, start_time').eq('course_id', created.id)
    expect(lessons?.length).toBe(1)

    // 2. READ
    const readRes = await school.get(`/api/school/courses/${created.id}`)
    expect(readRes.ok()).toBe(true)
    const readBody = await readRes.json()
    // Body shape can vary; check name is somewhere in it
    expect(JSON.stringify(readBody)).toContain(courseName)

    // 3. UPDATE — PUT requires lesson_type_id and name even when editing
    const updateRes = await school.put(`/api/school/courses/${created.id}`, {
      data: {
        lesson_type_id: ctx.lessonTypeId,
        name: `${courseName}-updated`,
        description: 'updated',
        max_capacity: 20,
        credit_cost: 2,
        duration_minutes: 90,
        start_time: '10:00',
      },
    })
    expect(updateRes.ok()).toBe(true)

    const { data: updated } = await adminDb
      .from('courses').select('name, max_capacity, credit_cost, duration_minutes').eq('id', created.id).single()
    expect(updated?.name).toBe(`${courseName}-updated`)
    expect(updated?.max_capacity).toBe(20)
    expect(updated?.credit_cost).toBe(2)

    // 4. DELETE
    const delRes = await school.delete(`/api/school/courses/${created.id}`)
    expect(delRes.ok()).toBe(true)

    const { data: gone } = await adminDb
      .from('courses').select('id').eq('id', created.id).maybeSingle()
    expect(gone).toBeNull()

    const { data: lessonsGone } = await adminDb
      .from('lessons').select('id').eq('course_id', created.id)
    expect(lessonsGone?.length ?? 0).toBe(0)

    // Already deleted — remove from cleanup list so afterEach doesn't re-try
    ctx.createdCourseIds = ctx.createdCourseIds.filter(i => i !== created.id)

    await school.dispose()
  })

  test('weekly frequency generates multiple lessons', async () => {
    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })

    const uniq = Date.now().toString(36)
    const createRes = await school.post('/api/school/courses', {
      data: {
        lesson_type_id: ctx.lessonTypeId,
        name: `e2e-weekly-${uniq}`,
        frequency: 'weekly',
        start_date: inDays(1),
        end_date: inDays(30),    // ~4 weekly occurrences
        start_time: '14:00',
        duration_minutes: 60,
        max_capacity: 5,
        credit_cost: 1,
        min_booking_notice_hours: 2,
      },
    })
    expect(createRes.ok()).toBe(true)
    const created = await createRes.json()
    expect(Number(created.lessons_created)).toBeGreaterThanOrEqual(4)
    ctx.createdCourseIds.push(created.id)

    const { data: lessons } = await adminDb
      .from('lessons').select('id').eq('course_id', created.id)
    expect(lessons?.length).toBe(Number(created.lessons_created))

    await school.dispose()
  })

  test('create without lesson_type_id or name → 400', async () => {
    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })

    // Missing lesson_type_id
    const res1 = await school.post('/api/school/courses', {
      data: {
        name: `e2e-bad-${Date.now().toString(36)}`,
        frequency: 'single',
        start_date: inDays(3),
        start_time: '10:00',
        duration_minutes: 60,
      },
    })
    expect(res1.status()).toBe(400)

    // Missing name
    const res2 = await school.post('/api/school/courses', {
      data: {
        lesson_type_id: ctx.lessonTypeId,
        frequency: 'single',
        start_date: inDays(3),
        start_time: '10:00',
        duration_minutes: 60,
      },
    })
    expect(res2.status()).toBe(400)

    await school.dispose()
  })

  test('HQ user cannot create a course on a school (403 or 401)', async () => {
    const hq = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: HQ_AUTH,
    })

    const res = await hq.post('/api/school/courses', {
      data: {
        lesson_type_id: ctx.lessonTypeId,
        name: `e2e-forbid-${Date.now().toString(36)}`,
        frequency: 'single',
        start_date: inDays(3),
        start_time: '10:00',
        duration_minutes: 60,
        max_capacity: 10,
        credit_cost: 1,
      },
    })
    expect([401, 403]).toContain(res.status())

    await hq.dispose()
  })
})
