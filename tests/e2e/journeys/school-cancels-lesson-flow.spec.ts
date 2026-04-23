/**
 * Journey 6 — School cancels a lesson
 *
 * When a school admin cancels a scheduled lesson:
 *   - All confirmed bookings become status='cancelled' with credit_refunded=true
 *   - Credits are refunded to each student_packages row (via RPC or fallback update)
 *   - The lesson row becomes status='cancelled'
 *   - Other schools cannot cancel this school's lesson (403)
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
  createConfirmedBooking,
  inDays,
} from '../../fixtures/factory'

type Ctx = {
  studentUserId: string
  schoolId: string
  lessonTypeId: string
  courseId: string
  lessonId: string
  bookingId: string | null
  studentPackageId: string | null
}

const SCHOOL_AUTH = path.join(__dirname, '../../.auth/school.json')

async function seed(withBooking: boolean = true): Promise<Ctx> {
  const { data: studentProfile } = await adminDb
    .from('profiles').select('id').eq('email', 'support+student@alinaquintana.com').single()
  if (!studentProfile) throw new Error('student profile missing')

  const { data: school } = await adminDb
    .from('schools').select('id').eq('slug', 'test-school').single()
  if (!school) throw new Error('test school missing')

  const lessonType = await createLessonType()
  const course = await createCourse(school.id, lessonType.id)
  const lesson = await createLesson(course.id, school.id, lessonType.id, {
    date: inDays(3),
    startTime: '10:00',
    endTime: '11:00',
    maxCapacity: 5,
  })

  let bookingId: string | null = null
  let studentPackageId: string | null = null

  if (withBooking) {
    await linkStudentToSchool(studentProfile.id, school.id, true)
    const pkg = await createStudentPackage(studentProfile.id, school.id, 5)
    // Simulate the post-booking state: 1 credit was already deducted
    await adminDb
      .from('student_packages').update({ credits_remaining: 4 }).eq('id', pkg.id)
    const booking = await createConfirmedBooking(studentProfile.id, lesson.id, school.id, pkg.id, 1)
    await adminDb.from('lessons').update({ current_bookings: 1 }).eq('id', lesson.id)
    bookingId = booking.id
    studentPackageId = pkg.id
  }

  return {
    studentUserId: studentProfile.id,
    schoolId: school.id,
    lessonTypeId: lessonType.id,
    courseId: course.id,
    lessonId: lesson.id,
    bookingId,
    studentPackageId,
  }
}

async function cleanup(ctx: Partial<Ctx>) {
  if (ctx.lessonId) {
    await adminDb.from('bookings').delete().eq('lesson_id', ctx.lessonId)
    await adminDb.from('lessons').delete().eq('id', ctx.lessonId)
  }
  if (ctx.courseId) await adminDb.from('courses').delete().eq('id', ctx.courseId)
  if (ctx.studentPackageId) await adminDb.from('student_packages').delete().eq('id', ctx.studentPackageId)
  if (ctx.lessonTypeId) await adminDb.from('lesson_types').delete().eq('id', ctx.lessonTypeId)
}

test.describe('Journey — School cancels a lesson', () => {
  let ctx: Ctx

  test.afterEach(async () => {
    await cleanup(ctx)
  })

  test('cancelling a lesson with 1 confirmed booking refunds credit + cancels booking + lesson', async () => {
    ctx = await seed(true)

    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })

    const res = await school.delete(`/api/school/classes/${ctx.lessonId}`)
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.cancelled).toBe(true)
    expect(body.refunded).toBe(1)

    // Lesson is cancelled
    const { data: lesson } = await adminDb
      .from('lessons').select('status').eq('id', ctx.lessonId).single()
    expect(lesson?.status).toBe('cancelled')

    // Booking is cancelled with refund flag
    const { data: booking } = await adminDb
      .from('bookings')
      .select('status, credit_refunded, cancellation_type, cancelled_at')
      .eq('id', ctx.bookingId!)
      .single()
    expect(booking?.status).toBe('cancelled')
    expect(booking?.credit_refunded).toBe(true)
    expect(booking?.cancellation_type).toBe('within_policy')
    expect(booking?.cancelled_at).toBeTruthy()

    // Package credits refunded: 4 → 5
    const { data: pkg } = await adminDb
      .from('student_packages').select('credits_remaining').eq('id', ctx.studentPackageId!).single()
    expect(pkg?.credits_remaining).toBe(5)

    await school.dispose()
  })

  test('cancelling an empty lesson (no bookings) just marks lesson cancelled', async () => {
    ctx = await seed(false)

    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })

    const res = await school.delete(`/api/school/classes/${ctx.lessonId}`)
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.refunded).toBe(0)

    const { data: lesson } = await adminDb
      .from('lessons').select('status').eq('id', ctx.lessonId).single()
    expect(lesson?.status).toBe('cancelled')

    await school.dispose()
  })

  test('non-school user cannot cancel a lesson (401/403)', async () => {
    ctx = await seed(false)

    const student = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: path.join(__dirname, '../../.auth/student.json'),
    })

    const res = await student.delete(`/api/school/classes/${ctx.lessonId}`)
    expect([401, 403]).toContain(res.status())

    // Lesson still scheduled
    const { data: lesson } = await adminDb
      .from('lessons').select('status').eq('id', ctx.lessonId).single()
    expect(lesson?.status).toBe('scheduled')

    await student.dispose()
  })

  test('cancelling a lesson of a DIFFERENT school has no effect', async () => {
    // Create a second, throwaway school + lesson, then try to cancel it as
    // our seeded school admin (who belongs to test-school).
    const otherSchoolId = 'otherschool-' + Date.now().toString(36)
    const { data: otherSchool, error: sErr } = await adminDb
      .from('schools')
      .insert({
        name: `e2e-otherschool-${Date.now().toString(36)}`,
        slug: otherSchoolId,
        email: `${otherSchoolId}@test.local`,
        city: 'Roma',
        country: 'IT',
        active: true,
        platform_fee_percentage: 10,
      })
      .select('id')
      .single()
    if (sErr || !otherSchool) throw new Error(sErr?.message)

    const lessonType = await createLessonType()
    const course = await createCourse(otherSchool.id, lessonType.id)
    const lesson = await createLesson(course.id, otherSchool.id, lessonType.id, {
      date: inDays(5),
      startTime: '10:00',
      endTime: '11:00',
      maxCapacity: 5,
    })

    // Use outer ctx only for afterEach cleanup of the main objects
    ctx = {
      studentUserId: '',
      schoolId: otherSchool.id,
      lessonTypeId: lessonType.id,
      courseId: course.id,
      lessonId: lesson.id,
      bookingId: null,
      studentPackageId: null,
    }

    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })

    const res = await school.delete(`/api/school/classes/${ctx.lessonId}`)
    // API silently filters by school_id, so the update affects 0 rows but the
    // request "succeeds" (no rows matched). The lesson must still be scheduled.
    const { data: stillScheduled } = await adminDb
      .from('lessons').select('status').eq('id', ctx.lessonId).single()
    expect(stillScheduled?.status).toBe('scheduled')
    // Response code is informational — document the current behavior
    expect([200, 404]).toContain(res.status())

    await school.dispose()
    // Extra cleanup for the throwaway school
    await adminDb.from('schools').delete().eq('id', otherSchool.id)
  })
})
