/**
 * Journey 3 — Package purchase / manual credit grant
 *
 * School admin assigns a catalog package to a student via
 *   POST /api/school/credits/grant
 * which is the path used when a student pays cash in person.
 *
 *   1. Grant with package_catalog_id + amount → new student_packages row
 *      is created with credits_total/credits_remaining equal to the amount,
 *      and manual_credit_grants row records the transaction
 *   2. Grant with price > 0 → transactions row is recorded with correct
 *      platform_fee / school_amount split based on schools.platform_fee_percentage
 *   3. Grant without package_catalog_id falls back to a virtual manual package
 *   4. Validation: bad reason, zero amount, wrong-school student → errors
 *   5. The granted credits are usable: student can POST /api/bookings
 *      with access_source=package and credits_deducted=1
 */

import { test, expect, request as pwRequest } from '@playwright/test'
import path from 'node:path'
import { adminDb } from '../../helpers/db'
import {
  createPackage,
  createLessonType,
  createCourse,
  createLesson,
  linkStudentToSchool,
  inDays,
} from '../../fixtures/factory'

type Ctx = {
  studentUserId: string
  studentRowId: string  // students.id (distinct from auth.users.id)
  schoolId: string
  packageId: string
}

const SCHOOL_AUTH = path.join(__dirname, '../../.auth/school.json')
const STUDENT_AUTH = path.join(__dirname, '../../.auth/student.json')

async function seed(): Promise<Ctx> {
  const { data: studentProfile } = await adminDb
    .from('profiles').select('id').eq('email', 'support+student@alinaquintana.com').single()
  if (!studentProfile) throw new Error('student profile missing')

  const { data: studentRow } = await adminDb
    .from('students').select('id').eq('user_id', studentProfile.id).single()
  if (!studentRow) throw new Error('students row missing')

  const { data: school } = await adminDb
    .from('schools').select('id').eq('slug', 'test-school').single()
  if (!school) throw new Error('test school missing')

  await linkStudentToSchool(studentProfile.id, school.id, /* freeLessonUsed */ true)
  const pkg = await createPackage(school.id, { credits: 10, price: 50 })

  return {
    studentUserId: studentProfile.id,
    studentRowId: studentRow.id,
    schoolId: school.id,
    packageId: pkg.id,
  }
}

async function cleanup(ctx: Partial<Ctx>) {
  if (ctx.studentUserId) {
    await adminDb.from('manual_credit_grants').delete().eq('student_id', ctx.studentUserId)
    await adminDb.from('student_packages').delete().eq('student_id', ctx.studentUserId).eq('school_id', ctx.schoolId)
  }
  if (ctx.studentRowId) {
    await adminDb.from('transactions').delete().eq('student_id', ctx.studentRowId).eq('school_id', ctx.schoolId)
  }
  if (ctx.packageId) await adminDb.from('packages').delete().eq('id', ctx.packageId)
}

test.describe('Journey — Package purchase (school-assigned)', () => {
  let ctx: Ctx

  test.beforeEach(async () => {
    ctx = await seed()
  })

  test.afterEach(async () => {
    await cleanup(ctx)
  })

  test('school admin grants catalog package → student_packages + grant row created', async () => {
    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })

    const res = await school.post('/api/school/credits/grant', {
      data: {
        student_id: ctx.studentUserId,
        amount: 10,
        reason: 'gift',
        package_catalog_id: ctx.packageId,
      },
    })
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.granted).toBe(true)
    expect(body.package_id).toBeTruthy()

    // Verify student_packages row
    const { data: pkg } = await adminDb
      .from('student_packages')
      .select('credits_total, credits_remaining, package_id, status, payment_method, school_id')
      .eq('id', body.package_id)
      .single()
    expect(pkg?.credits_total).toBe(10)
    expect(pkg?.credits_remaining).toBe(10)
    expect(pkg?.package_id).toBe(ctx.packageId)
    expect(pkg?.status).toBe('active')
    expect(pkg?.payment_method).toBe('manual')
    expect(pkg?.school_id).toBe(ctx.schoolId)

    // Verify manual_credit_grants row
    const { data: grant } = await adminDb
      .from('manual_credit_grants')
      .select('amount, reason, package_id, school_id, student_id')
      .eq('package_id', body.package_id)
      .single()
    expect(grant?.amount).toBe(10)
    expect(grant?.reason).toBe('gift')
    expect(grant?.school_id).toBe(ctx.schoolId)
    expect(grant?.student_id).toBe(ctx.studentUserId)

    await school.dispose()
  })

  test('grant with price > 0 records a transaction with correct platform fee split', async () => {
    // Test school has platform_fee_percentage = 10% (set in create-test-users.mjs)
    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })

    const res = await school.post('/api/school/credits/grant', {
      data: {
        student_id: ctx.studentUserId,
        amount: 10,
        reason: 'gift',
        package_catalog_id: ctx.packageId,
        price: 50,
        payment_method: 'cash',
      },
    })
    expect(res.ok()).toBe(true)

    // Fetch the transaction (API resolves user.id → students.id for this FK)
    const { data: tx } = await adminDb
      .from('transactions')
      .select('amount, platform_fee, school_amount, currency, type, payment_method, status, school_id')
      .eq('student_id', ctx.studentRowId)
      .eq('school_id', ctx.schoolId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    expect(tx?.amount).toBe(50)
    expect(tx?.platform_fee).toBe(5)    // 10% of 50
    expect(tx?.school_amount).toBe(45)   // 50 - 5
    expect(tx?.currency).toBe('eur')
    expect(tx?.type).toBe('package')
    expect(tx?.payment_method).toBe('cash')
    expect(tx?.status).toBe('completed')

    await school.dispose()
  })

  test('grant without package_catalog_id creates a virtual manual package', async () => {
    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })

    const res = await school.post('/api/school/credits/grant', {
      data: {
        student_id: ctx.studentUserId,
        amount: 7,
        reason: 'compensation',
        note: 'lesson cancelled',
      },
    })
    expect(res.ok()).toBe(true)
    const body = await res.json()

    const { data: pkg } = await adminDb
      .from('student_packages')
      .select('credits_total, credits_remaining, package_id, payment_method')
      .eq('id', body.package_id)
      .single()
    expect(pkg?.credits_total).toBe(7)
    expect(pkg?.credits_remaining).toBe(7)
    expect(pkg?.package_id).toBeNull()    // virtual (not tied to catalog)
    expect(pkg?.payment_method).toBe('manual')

    await school.dispose()
  })

  test('validation: invalid reason is rejected (400)', async () => {
    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })
    const res = await school.post('/api/school/credits/grant', {
      data: {
        student_id: ctx.studentUserId,
        amount: 5,
        reason: 'bogus',
      },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/invalid reason/i)
    await school.dispose()
  })

  test('validation: zero amount is rejected (400)', async () => {
    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })
    const res = await school.post('/api/school/credits/grant', {
      data: {
        student_id: ctx.studentUserId,
        amount: 0,
        reason: 'gift',
      },
    })
    expect(res.status()).toBe(400)
    await school.dispose()
  })

  test('validation: cannot grant to a student not linked to this school (404)', async () => {
    // Remove the school_students link
    await adminDb
      .from('school_students')
      .delete()
      .eq('student_id', ctx.studentUserId)
      .eq('school_id', ctx.schoolId)

    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })
    const res = await school.post('/api/school/credits/grant', {
      data: {
        student_id: ctx.studentUserId,
        amount: 5,
        reason: 'gift',
        package_catalog_id: ctx.packageId,
      },
    })
    expect(res.status()).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/not found/i)
    await school.dispose()

    // Restore the link for other tests
    await linkStudentToSchool(ctx.studentUserId, ctx.schoolId, true)
  })

  test('granted credits are usable: student books a lesson and credit is deducted', async () => {
    // Grant the student 10 credits from the catalog package
    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })
    const grantRes = await school.post('/api/school/credits/grant', {
      data: {
        student_id: ctx.studentUserId,
        amount: 10,
        reason: 'gift',
        package_catalog_id: ctx.packageId,
      },
    })
    expect(grantRes.ok()).toBe(true)
    const { package_id: studentPkgId } = await grantRes.json()
    await school.dispose()

    // Seed a lesson so the student has something to book
    const lessonType = await createLessonType()
    const course = await createCourse(ctx.schoolId, lessonType.id)
    const lesson = await createLesson(course.id, ctx.schoolId, lessonType.id, {
      date: inDays(3),
      startTime: '10:00',
      endTime: '11:00',
      maxCapacity: 5,
    })

    try {
      const student = await pwRequest.newContext({
        baseURL: 'http://localhost:3000',
        storageState: STUDENT_AUTH,
      })

      const bookRes = await student.post('/api/bookings', {
        data: { lesson_id: lesson.id },
      })
      expect(bookRes.ok()).toBe(true)
      const booking = await bookRes.json()
      expect(booking.access_source).toBe('package')

      // Student's package credits went 10 → 9
      const { data: pkg } = await adminDb
        .from('student_packages').select('credits_remaining').eq('id', studentPkgId).single()
      expect(pkg?.credits_remaining).toBe(9)

      await student.dispose()
    } finally {
      // Lesson-specific cleanup (the outer afterEach handles package+grants)
      await adminDb.from('bookings').delete().eq('lesson_id', lesson.id)
      await adminDb.from('lessons').delete().eq('id', lesson.id)
      await adminDb.from('courses').delete().eq('id', course.id)
      await adminDb.from('lesson_types').delete().eq('id', lessonType.id)
    }
  })
})
