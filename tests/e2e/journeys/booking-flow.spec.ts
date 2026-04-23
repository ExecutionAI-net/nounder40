/**
 * Journey 1 — Core Booking Flow
 *
 * Covers the heart of the product:
 *   1. School creates a course + lesson (via factory, bypasses UI wizard)
 *   2. Student has credits (via factory)
 *   3. Student books the lesson via POST /api/bookings
 *   4. Booking row exists with status=confirmed
 *   5. Credit was deducted from student_packages
 *   6. lessons.current_bookings was incremented
 *   7. Student cancels the booking via DELETE /api/bookings/:id
 *   8. Credit refunded (within policy)
 *   9. lessons.current_bookings decremented
 *
 * All rows are tagged `e2e-` and cleaned up after each test, even on failure.
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

type TestCtx = {
  studentUserId: string
  schoolId: string
  lessonTypeId: string
  courseId: string
  lessonId: string
  studentPackageId: string
}

const STUDENT_AUTH = path.join(__dirname, '../../.auth/student.json')

async function seedBookingScenario(): Promise<TestCtx> {
  // Student user
  const { data: studentProfile, error: e1 } = await adminDb
    .from('profiles')
    .select('id')
    .eq('email', 'support+student@alinaquintana.com')
    .single()
  if (e1 || !studentProfile) throw new Error(`student not found: ${e1?.message}`)

  // Test school
  const { data: school, error: e2 } = await adminDb
    .from('schools')
    .select('id')
    .eq('slug', 'test-school')
    .single()
  if (e2 || !school) throw new Error(`test school not found: ${e2?.message}`)

  const lessonType = await createLessonType()
  const course = await createCourse(school.id, lessonType.id)
  // Lesson 3 days out: comfortably past min_booking_notice_hours (2) AND
  // default cancellation_policy_hours (24) so "within policy" tests work
  // regardless of what time of day the test runs.
  const lesson = await createLesson(course.id, school.id, lessonType.id, {
    date: inDays(3),
    startTime: '10:00',
    endTime: '11:00',
    maxCapacity: 5,
  })
  await linkStudentToSchool(studentProfile.id, school.id, /* freeLessonUsed */ true)
  const pkg = await createStudentPackage(studentProfile.id, school.id, /* credits */ 5)

  return {
    studentUserId: studentProfile.id,
    schoolId: school.id,
    lessonTypeId: lessonType.id,
    courseId: course.id,
    lessonId: lesson.id,
    studentPackageId: pkg.id,
  }
}

async function cleanup(ctx: Partial<TestCtx>) {
  if (ctx.lessonId) {
    await adminDb.from('bookings').delete().eq('lesson_id', ctx.lessonId)
    await adminDb.from('lessons').delete().eq('id', ctx.lessonId)
  }
  if (ctx.courseId) await adminDb.from('courses').delete().eq('id', ctx.courseId)
  if (ctx.studentPackageId) await adminDb.from('student_packages').delete().eq('id', ctx.studentPackageId)
  if (ctx.lessonTypeId) await adminDb.from('lesson_types').delete().eq('id', ctx.lessonTypeId)
}

test.describe('Journey — Core Booking Flow', () => {
  let ctx: TestCtx

  test.beforeEach(async () => {
    ctx = await seedBookingScenario()
  })

  test.afterEach(async () => {
    await cleanup(ctx)
  })

  test('student books lesson → credits decremented, booking confirmed, lesson count incremented', async () => {
    // Use student's stored auth session against the dev server.
    const context = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: STUDENT_AUTH,
    })

    // Act: book the lesson
    const bookRes = await context.post('/api/bookings', {
      data: { lesson_id: ctx.lessonId },
    })
    expect(bookRes.ok()).toBe(true)
    const bookBody = await bookRes.json()
    expect(bookBody.id).toBeTruthy()
    expect(bookBody.access_source).toBe('package')

    // Verify: booking row
    const { data: booking, error: bErr } = await adminDb
      .from('bookings')
      .select('id, status, student_id, lesson_id, credits_deducted, access_source')
      .eq('id', bookBody.id)
      .single()
    expect(bErr).toBeNull()
    expect(booking?.status).toBe('confirmed')
    expect(booking?.student_id).toBe(ctx.studentUserId)
    expect(booking?.lesson_id).toBe(ctx.lessonId)
    expect(booking?.credits_deducted).toBe(1)
    expect(booking?.access_source).toBe('package')

    // Verify: student_packages credits decremented 5 → 4
    const { data: pkg } = await adminDb
      .from('student_packages')
      .select('credits_remaining, status')
      .eq('id', ctx.studentPackageId)
      .single()
    expect(pkg?.credits_remaining).toBe(4)
    expect(pkg?.status).toBe('active')

    // Verify: lessons.current_bookings 0 → 1 (service-role client in the API
    // bypasses the student-RLS restriction on lessons UPDATE).
    const { data: lesson } = await adminDb
      .from('lessons')
      .select('current_bookings')
      .eq('id', ctx.lessonId)
      .single()
    expect(lesson?.current_bookings).toBe(1)

    await context.dispose()
  })

  test('double booking is prevented', async () => {
    const context = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: STUDENT_AUTH,
    })

    const first = await context.post('/api/bookings', { data: { lesson_id: ctx.lessonId } })
    expect(first.ok()).toBe(true)

    const second = await context.post('/api/bookings', { data: { lesson_id: ctx.lessonId } })
    expect(second.status()).toBe(400)
    const body = await second.json()
    expect(body.error).toMatch(/already booked/i)

    // Credits should only be deducted once
    const { data: pkg } = await adminDb
      .from('student_packages')
      .select('credits_remaining')
      .eq('id', ctx.studentPackageId)
      .single()
    expect(pkg?.credits_remaining).toBe(4)

    // current_bookings also incremented only once
    const { data: lesson } = await adminDb
      .from('lessons').select('current_bookings').eq('id', ctx.lessonId).single()
    expect(lesson?.current_bookings).toBe(1)

    await context.dispose()
  })

  test('booking without credits is rejected', async () => {
    // Zero out the student's wallet first
    await adminDb
      .from('student_packages')
      .update({ credits_remaining: 0, status: 'exhausted' })
      .eq('id', ctx.studentPackageId)

    const context = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: STUDENT_AUTH,
    })

    const res = await context.post('/api/bookings', { data: { lesson_id: ctx.lessonId } })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/credits/i)

    const { data: lesson } = await adminDb
      .from('lessons')
      .select('current_bookings')
      .eq('id', ctx.lessonId)
      .single()
    expect(lesson?.current_bookings).toBe(0)

    await context.dispose()
  })

  test('capacity guard: booking a full lesson is rejected', async () => {
    // Simulate a lesson that filled via some other student's bookings.
    // The main "books lesson" test above proves current_bookings increments
    // correctly end-to-end; this test isolates the capacity guard itself.
    await adminDb
      .from('lessons')
      .update({ current_bookings: 5, max_capacity: 5 })
      .eq('id', ctx.lessonId)

    const context = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: STUDENT_AUTH,
    })

    const res = await context.post('/api/bookings', { data: { lesson_id: ctx.lessonId } })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/full/i)

    // Credits were NOT deducted for the rejected booking
    const { data: pkg } = await adminDb
      .from('student_packages')
      .select('credits_remaining')
      .eq('id', ctx.studentPackageId)
      .single()
    expect(pkg?.credits_remaining).toBe(5)

    await context.dispose()
  })

  test('cancelling a booking within policy refunds the credit', async () => {
    const context = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: STUDENT_AUTH,
    })

    // Book first
    const bookRes = await context.post('/api/bookings', { data: { lesson_id: ctx.lessonId } })
    expect(bookRes.ok()).toBe(true)
    const { id: bookingId } = await bookRes.json()

    // Sanity: credits at 4, lesson count at 1
    let pkg = (await adminDb
      .from('student_packages').select('credits_remaining').eq('id', ctx.studentPackageId).single()).data
    expect(pkg?.credits_remaining).toBe(4)

    // Cancel
    const cancelRes = await context.delete(`/api/bookings/${bookingId}`)
    expect(cancelRes.ok()).toBe(true)

    // Verify: booking is cancelled, credit refunded
    const { data: booking } = await adminDb
      .from('bookings')
      .select('status, credit_refunded')
      .eq('id', bookingId)
      .single()
    expect(booking?.status).toBe('cancelled')
    expect(booking?.credit_refunded).toBe(true)

    pkg = (await adminDb
      .from('student_packages').select('credits_remaining').eq('id', ctx.studentPackageId).single()).data
    expect(pkg?.credits_remaining).toBe(5)  // refunded

    // Capacity slot is released
    const { data: lesson } = await adminDb
      .from('lessons').select('current_bookings').eq('id', ctx.lessonId).single()
    expect(lesson?.current_bookings).toBe(0)

    await context.dispose()
  })
})
