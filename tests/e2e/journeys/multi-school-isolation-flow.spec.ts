/**
 * Journey 9 — Multi-school credit isolation
 *
 * A student can enroll in multiple schools. Their credit wallets must be
 * strictly per-school: credits purchased at School A cannot be spent at
 * School B, and booking at one must not touch the other's balance.
 *
 * Setup: the student is enrolled in test-school (School A) and a freshly
 * created School B; a lesson exists at each.
 */

import { test, expect, request as pwRequest } from '@playwright/test'
import path from 'node:path'
import { adminDb } from '../../helpers/db'
import {
  createLessonType,
  createCourse,
  createLesson,
  createStudentPackage,
  linkStudentToSchool,
  inDays,
} from '../../fixtures/factory'

type Ctx = {
  studentUserId: string
  schoolAId: string
  schoolBId: string
  lessonAId: string
  lessonBId: string
  courseAId: string
  courseBId: string
  lessonTypeId: string
  packageAId: string
  packageBId: string | null
}

const STUDENT_AUTH = path.join(__dirname, '../../.auth/student.json')

async function seed(): Promise<Ctx> {
  const { data: studentProfile } = await adminDb
    .from('profiles').select('id').eq('email', 'support+student@alinaquintana.com').single()
  if (!studentProfile) throw new Error('student profile missing')

  const { data: schoolA } = await adminDb
    .from('schools').select('id').eq('slug', 'test-school').single()
  if (!schoolA) throw new Error('test school missing')

  // Fresh second school (throwaway)
  const slug = `e2e-school-b-${Date.now().toString(36)}`
  const { data: schoolB, error: sErr } = await adminDb
    .from('schools')
    .insert({
      name: `e2e-school-b-${Date.now().toString(36)}`,
      slug,
      email: `${slug}@test.local`,
      city: 'Milano',
      country: 'IT',
      active: true,
      platform_fee_percentage: 10,
    })
    .select('id')
    .single()
  if (sErr || !schoolB) throw new Error(sErr?.message)

  // Enroll the student in both schools (free lesson already used for both)
  await linkStudentToSchool(studentProfile.id, schoolA.id, true)
  await linkStudentToSchool(studentProfile.id, schoolB.id, true)

  // One lesson at each school
  const lessonType = await createLessonType()

  const courseA = await createCourse(schoolA.id, lessonType.id)
  const lessonA = await createLesson(courseA.id, schoolA.id, lessonType.id, {
    date: inDays(3), startTime: '10:00', endTime: '11:00', maxCapacity: 5,
  })

  const courseB = await createCourse(schoolB.id, lessonType.id)
  const lessonB = await createLesson(courseB.id, schoolB.id, lessonType.id, {
    date: inDays(3), startTime: '11:00', endTime: '12:00', maxCapacity: 5,
  })

  // Student has credits only at School A
  const packageA = await createStudentPackage(studentProfile.id, schoolA.id, 5)

  return {
    studentUserId: studentProfile.id,
    schoolAId: schoolA.id,
    schoolBId: schoolB.id,
    lessonAId: lessonA.id,
    lessonBId: lessonB.id,
    courseAId: courseA.id,
    courseBId: courseB.id,
    lessonTypeId: lessonType.id,
    packageAId: packageA.id,
    packageBId: null,
  }
}

async function cleanup(ctx: Partial<Ctx>) {
  const lessonIds = [ctx.lessonAId, ctx.lessonBId].filter(Boolean) as string[]
  for (const lessonId of lessonIds) {
    await adminDb.from('bookings').delete().eq('lesson_id', lessonId)
    await adminDb.from('lessons').delete().eq('id', lessonId)
  }
  if (ctx.courseAId) await adminDb.from('courses').delete().eq('id', ctx.courseAId)
  if (ctx.courseBId) await adminDb.from('courses').delete().eq('id', ctx.courseBId)
  if (ctx.packageAId) await adminDb.from('student_packages').delete().eq('id', ctx.packageAId)
  if (ctx.packageBId) await adminDb.from('student_packages').delete().eq('id', ctx.packageBId)
  if (ctx.lessonTypeId) await adminDb.from('lesson_types').delete().eq('id', ctx.lessonTypeId)
  if (ctx.schoolBId) {
    await adminDb.from('school_students').delete().eq('school_id', ctx.schoolBId)
    await adminDb.from('schools').delete().eq('id', ctx.schoolBId)
  }
}

test.describe('Journey — Multi-school credit isolation', () => {
  let ctx: Ctx

  test.beforeEach(async () => {
    ctx = await seed()
  })

  test.afterEach(async () => {
    await cleanup(ctx)
  })

  test('booking at School A uses School A credits; School B book fails with no credits', async () => {
    const student = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: STUDENT_AUTH,
    })

    // Book at School A — should succeed
    const bookA = await student.post('/api/bookings', { data: { lesson_id: ctx.lessonAId } })
    expect(bookA.ok()).toBe(true)
    const bodyA = await bookA.json()
    expect(bodyA.access_source).toBe('package')

    // School A package: 5 → 4
    const { data: pkgAAfter } = await adminDb
      .from('student_packages').select('credits_remaining').eq('id', ctx.packageAId).single()
    expect(pkgAAfter?.credits_remaining).toBe(4)

    // Try to book at School B — should fail (no credits at B)
    const bookB = await student.post('/api/bookings', { data: { lesson_id: ctx.lessonBId } })
    expect(bookB.status()).toBe(400)
    const bodyB = await bookB.json()
    expect(bodyB.error).toMatch(/credits/i)

    // School A credits still at 4 (B attempt didn't touch them)
    const { data: pkgAFinal } = await adminDb
      .from('student_packages').select('credits_remaining').eq('id', ctx.packageAId).single()
    expect(pkgAFinal?.credits_remaining).toBe(4)

    // No booking row exists at School B
    const { data: bookingsAtB } = await adminDb
      .from('bookings')
      .select('id')
      .eq('student_id', ctx.studentUserId)
      .eq('school_id', ctx.schoolBId)
    expect(bookingsAtB?.length ?? 0).toBe(0)

    await student.dispose()
  })

  test('granting credits at School B enables booking there without touching School A', async () => {
    // Seed School B credits directly
    const pkgB = await createStudentPackage(ctx.studentUserId, ctx.schoolBId, 3)
    ctx.packageBId = pkgB.id

    const student = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: STUDENT_AUTH,
    })

    // Book at B — should succeed now
    const res = await student.post('/api/bookings', { data: { lesson_id: ctx.lessonBId } })
    expect(res.ok()).toBe(true)

    // School B package: 3 → 2
    const { data: pkgBAfter } = await adminDb
      .from('student_packages').select('credits_remaining').eq('id', pkgB.id).single()
    expect(pkgBAfter?.credits_remaining).toBe(2)

    // School A package untouched: still 5
    const { data: pkgAAfter } = await adminDb
      .from('student_packages').select('credits_remaining').eq('id', ctx.packageAId).single()
    expect(pkgAAfter?.credits_remaining).toBe(5)

    await student.dispose()
  })

  test('a package at School A is NOT returned in School B package queries', async () => {
    // Direct DB invariant: School B has no package for this student, even
    // though the student has a package at School A.
    const { data: pkgsAtB } = await adminDb
      .from('student_packages')
      .select('id, credits_remaining')
      .eq('student_id', ctx.studentUserId)
      .eq('school_id', ctx.schoolBId)
      .eq('status', 'active')
    expect(pkgsAtB?.length ?? 0).toBe(0)

    const { data: pkgsAtA } = await adminDb
      .from('student_packages')
      .select('id, credits_remaining')
      .eq('student_id', ctx.studentUserId)
      .eq('school_id', ctx.schoolAId)
      .eq('status', 'active')
    expect(pkgsAtA?.length).toBeGreaterThanOrEqual(1)
  })
})
