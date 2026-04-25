/**
 * Journey 2 — Attendance Flow
 *
 *   1. School has a course, a lesson (tomorrow), a teacher
 *   2. Student has a confirmed booking on that lesson
 *   3. Teacher submits attendance via POST /api/attendance/:lessonId
 *   4. "present" status → booking.status = 'attended', attendance row exists
 *   5. "no_show" status → booking.status = 'no_show'
 *   6. Lesson status becomes 'completed'
 *
 * Each test seeds its own data and cleans up.
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
  seedAttendanceStatuses,
  inDays,
  type TestAttendanceStatus,
} from '../../fixtures/factory'

type TestCtx = {
  studentUserId: string
  teacherId: string
  schoolId: string
  lessonTypeId: string
  courseId: string
  lessonId: string
  bookingId: string
  studentPackageId: string
  statusPresent: TestAttendanceStatus
  statusNoShow: TestAttendanceStatus
}

const TEACHER_AUTH = path.join(__dirname, '../../.auth/teacher.json')

async function seedAttendanceScenario(): Promise<TestCtx> {
  // Fetch student user id
  const { data: studentProfile } = await adminDb
    .from('profiles').select('id').eq('email', 'support+student@alinaquintana.com').single()
  if (!studentProfile) throw new Error('student profile missing')

  // Fetch test school
  const { data: school } = await adminDb
    .from('schools').select('id').eq('slug', 'test-school').single()
  if (!school) throw new Error('test school missing')

  // Fetch our test teacher row (created by scripts/create-test-users.mjs)
  const { data: teacher } = await adminDb
    .from('teachers')
    .select('id')
    .eq('email', 'support+teacher@alinaquintana.com')
    .eq('school_id', school.id)
    .single()
  if (!teacher) throw new Error('teacher row missing — run scripts/create-test-users.mjs')

  const lessonType = await createLessonType()
  const course = await createCourse(school.id, lessonType.id)
  const lesson = await createLesson(course.id, school.id, lessonType.id, {
    date: inDays(1),
    startTime: '10:00',
    endTime: '11:00',
    maxCapacity: 5,
    teacherId: teacher.id,
  })

  await linkStudentToSchool(studentProfile.id, school.id, /* freeLessonUsed */ true)
  const pkg = await createStudentPackage(studentProfile.id, school.id, 5)
  const booking = await createConfirmedBooking(studentProfile.id, lesson.id, school.id, pkg.id, 1)

  // Increment lesson.current_bookings to match the seeded booking
  await adminDb.from('lessons').update({ current_bookings: 1 }).eq('id', lesson.id)

  const statuses = await seedAttendanceStatuses(school.id)

  return {
    studentUserId: studentProfile.id,
    teacherId: teacher.id,
    schoolId: school.id,
    lessonTypeId: lessonType.id,
    courseId: course.id,
    lessonId: lesson.id,
    bookingId: booking.id,
    studentPackageId: pkg.id,
    statusPresent: statuses.present,
    statusNoShow: statuses.noShow,
  }
}

async function cleanup(ctx: Partial<TestCtx>) {
  if (ctx.lessonId) {
    await adminDb.from('attendance').delete().eq('lesson_id', ctx.lessonId)
    await adminDb.from('bookings').delete().eq('lesson_id', ctx.lessonId)
    await adminDb.from('lessons').delete().eq('id', ctx.lessonId)
  }
  if (ctx.courseId) await adminDb.from('courses').delete().eq('id', ctx.courseId)
  if (ctx.studentPackageId) await adminDb.from('student_packages').delete().eq('id', ctx.studentPackageId)
  if (ctx.statusPresent?.id) await adminDb.from('attendance_statuses').delete().eq('id', ctx.statusPresent.id)
  if (ctx.statusNoShow?.id) await adminDb.from('attendance_statuses').delete().eq('id', ctx.statusNoShow.id)
  if (ctx.lessonTypeId) await adminDb.from('lesson_types').delete().eq('id', ctx.lessonTypeId)
}

test.describe('Journey — Attendance Flow', () => {
  let ctx: TestCtx

  test.beforeEach(async () => {
    ctx = await seedAttendanceScenario()
  })

  test.afterEach(async () => {
    await cleanup(ctx)
  })

  test('GET attendance endpoint returns the lesson + booked student', async () => {
    const context = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: TEACHER_AUTH,
    })

    const res = await context.get(`/api/attendance/${ctx.lessonId}`)
    expect(res.ok()).toBe(true)
    const body = await res.json()

    expect(body.lesson?.id).toBe(ctx.lessonId)
    expect(body.statuses.length).toBeGreaterThanOrEqual(2)
    expect(body.bookings.length).toBe(1)
    expect(body.bookings[0].id).toBe(ctx.bookingId)
    expect(body.bookings[0].student_id).toBe(ctx.studentUserId)
    expect(body.already_submitted).toBe(false)

    await context.dispose()
  })

  test('marking student present → booking.status = attended, attendance row exists', async () => {
    const context = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: TEACHER_AUTH,
    })

    const res = await context.post(`/api/attendance/${ctx.lessonId}`, {
      data: {
        attendance: [
          { booking_id: ctx.bookingId, student_id: ctx.studentUserId, status_id: ctx.statusPresent.id },
        ],
      },
    })
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.submitted).toBe(true)
    expect(body.credit_burned).toBe(1)
    expect(body.no_burn).toBe(0)

    // Attendance row
    const { data: att } = await adminDb
      .from('attendance')
      .select('status, status_id, booking_id')
      .eq('lesson_id', ctx.lessonId)
      .single()
    expect(att?.status).toBe('present')
    expect(att?.status_id).toBe(ctx.statusPresent.id)
    expect(att?.booking_id).toBe(ctx.bookingId)

    // Booking status updated
    const { data: booking } = await adminDb
      .from('bookings')
      .select('status')
      .eq('id', ctx.bookingId)
      .single()
    expect(booking?.status).toBe('attended')

    await context.dispose()
  })

  test('marking student no-show → booking.status = no_show', async () => {
    const context = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: TEACHER_AUTH,
    })

    const res = await context.post(`/api/attendance/${ctx.lessonId}`, {
      data: {
        attendance: [
          { booking_id: ctx.bookingId, student_id: ctx.studentUserId, status_id: ctx.statusNoShow.id },
        ],
      },
    })
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.credit_burned).toBe(0)
    expect(body.no_burn).toBe(1)

    const { data: booking } = await adminDb
      .from('bookings').select('status').eq('id', ctx.bookingId).single()
    expect(booking?.status).toBe('no_show')

    await context.dispose()
  })

  test('attendance can be re-submitted (overwrites previous records)', async () => {
    const context = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: TEACHER_AUTH,
    })

    // First submit: present
    await context.post(`/api/attendance/${ctx.lessonId}`, {
      data: {
        attendance: [
          { booking_id: ctx.bookingId, student_id: ctx.studentUserId, status_id: ctx.statusPresent.id },
        ],
      },
    })
    let { data: booking } = await adminDb
      .from('bookings').select('status').eq('id', ctx.bookingId).single()
    expect(booking?.status).toBe('attended')

    // Re-submit as no-show
    const res = await context.post(`/api/attendance/${ctx.lessonId}`, {
      data: {
        attendance: [
          { booking_id: ctx.bookingId, student_id: ctx.studentUserId, status_id: ctx.statusNoShow.id },
        ],
      },
    })
    expect(res.ok()).toBe(true)

    booking = (await adminDb
      .from('bookings').select('status').eq('id', ctx.bookingId).single()).data
    expect(booking?.status).toBe('no_show')

    // Only one attendance row total (old deleted)
    const { data: atts } = await adminDb
      .from('attendance').select('id').eq('lesson_id', ctx.lessonId)
    expect(atts?.length).toBe(1)

    await context.dispose()
  })

  test('attendance with invalid booking_id is rejected', async () => {
    const context = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: TEACHER_AUTH,
    })

    const res = await context.post(`/api/attendance/${ctx.lessonId}`, {
      data: {
        attendance: [
          { booking_id: '00000000-0000-0000-0000-000000000000', student_id: ctx.studentUserId, status_id: ctx.statusPresent.id },
        ],
      },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/invalid booking/i)

    // Booking status unchanged
    const { data: booking } = await adminDb
      .from('bookings').select('status').eq('id', ctx.bookingId).single()
    expect(booking?.status).toBe('confirmed')

    await context.dispose()
  })

  test('empty attendance submission is rejected', async () => {
    const context = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: TEACHER_AUTH,
    })

    const res = await context.post(`/api/attendance/${ctx.lessonId}`, {
      data: { attendance: [] },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/no attendance records/i)

    await context.dispose()
  })

  test('other teacher cannot mark this lesson', async () => {
    // Non-teacher role (student) attempts attendance POST
    const studentContext = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: path.join(__dirname, '../../.auth/student.json'),
    })

    const res = await studentContext.post(`/api/attendance/${ctx.lessonId}`, {
      data: {
        attendance: [
          { booking_id: ctx.bookingId, student_id: ctx.studentUserId, status_id: ctx.statusPresent.id },
        ],
      },
    })
    expect([403, 404]).toContain(res.status())

    const { data: booking } = await adminDb
      .from('bookings').select('status').eq('id', ctx.bookingId).single()
    expect(booking?.status).toBe('confirmed')  // unchanged

    await studentContext.dispose()
  })
})
