/**
 * Journey 2b — Attendance Flow via UI
 *
 * Seeds a lesson with a confirmed booking, navigates the teacher browser to
 * /teacher/attendance/:lessonId, clicks a status chip, clicks Save, and then
 * verifies the DB reflects the marking.
 */

import { test, expect } from '@playwright/test'
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

type Ctx = {
  studentUserId: string
  schoolId: string
  lessonTypeId: string
  courseId: string
  lessonId: string
  bookingId: string
  studentPackageId: string
  statusPresent: TestAttendanceStatus
  statusNoShow: TestAttendanceStatus
}

test.use({ storageState: path.join(__dirname, '../../.auth/teacher.json') })

async function seed(): Promise<Ctx> {
  const { data: studentProfile } = await adminDb
    .from('profiles').select('id').eq('email', 'support+student@alinaquintana.com').single()
  if (!studentProfile) throw new Error('student profile missing')

  const { data: school } = await adminDb
    .from('schools').select('id').eq('slug', 'test-school').single()
  if (!school) throw new Error('test school missing')

  const { data: teacher } = await adminDb
    .from('teachers').select('id')
    .eq('email', 'support+teacher@alinaquintana.com').eq('school_id', school.id).single()
  if (!teacher) throw new Error('teacher row missing')

  const lessonType = await createLessonType()
  const course = await createCourse(school.id, lessonType.id)
  const lesson = await createLesson(course.id, school.id, lessonType.id, {
    date: inDays(1),
    startTime: '10:00',
    endTime: '11:00',
    maxCapacity: 5,
    teacherId: teacher.id,
  })
  await linkStudentToSchool(studentProfile.id, school.id)
  const pkg = await createStudentPackage(studentProfile.id, school.id, 5)
  const booking = await createConfirmedBooking(studentProfile.id, lesson.id, school.id, pkg.id, 1)
  await adminDb.from('lessons').update({ current_bookings: 1 }).eq('id', lesson.id)
  const statuses = await seedAttendanceStatuses(school.id)

  return {
    studentUserId: studentProfile.id,
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

async function cleanup(ctx: Partial<Ctx>) {
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

test.describe('Journey UI — Teacher marks attendance via browser', () => {
  let ctx: Ctx

  test.beforeEach(async () => {
    ctx = await seed()
  })

  test.afterEach(async () => {
    await cleanup(ctx)
  })

  test('attendance page shows booked student with status chips', async ({ page }) => {
    await page.goto(`/en/teacher/attendance/${ctx.lessonId}`)

    await expect(page.getByRole('heading', { name: 'Mark Attendance' })).toBeVisible({ timeout: 30000 })

    // Student's name appears (fetched from profiles)
    await expect(page.getByText('Test Student')).toBeVisible()

    // Both status chips rendered
    await expect(page.getByRole('button', { name: new RegExp(ctx.statusPresent.name) })).toBeVisible()
    await expect(page.getByRole('button', { name: new RegExp(ctx.statusNoShow.name) })).toBeVisible()

    // Save button rendered
    await expect(page.getByRole('button', { name: 'Save Attendance' })).toBeVisible()
  })

  test('clicking Present and Save updates booking to attended', async ({ page }) => {
    await page.goto(`/en/teacher/attendance/${ctx.lessonId}`)
    await expect(page.getByRole('heading', { name: 'Mark Attendance' })).toBeVisible({ timeout: 30000 })

    await page.getByRole('button', { name: new RegExp(ctx.statusPresent.name) }).click()
    await page.getByRole('button', { name: 'Save Attendance' }).click()

    // The form redirects to the attendance list on success
    await page.waitForURL(/\/teacher\/attendance(?!\/)/, { timeout: 15000 })

    // DB reflects the change
    const { data: booking } = await adminDb
      .from('bookings').select('status').eq('id', ctx.bookingId).single()
    expect(booking?.status).toBe('attended')

    const { data: att } = await adminDb
      .from('attendance').select('status, status_id').eq('lesson_id', ctx.lessonId).single()
    expect(att?.status).toBe('present')
    expect(att?.status_id).toBe(ctx.statusPresent.id)
  })

  test('clicking No-Show and Save updates booking to no_show', async ({ page }) => {
    await page.goto(`/en/teacher/attendance/${ctx.lessonId}`)
    await expect(page.getByRole('heading', { name: 'Mark Attendance' })).toBeVisible({ timeout: 30000 })

    await page.getByRole('button', { name: new RegExp(ctx.statusNoShow.name) }).click()
    await page.getByRole('button', { name: 'Save Attendance' }).click()

    await page.waitForURL(/\/teacher\/attendance(?!\/)/, { timeout: 15000 })

    const { data: booking } = await adminDb
      .from('bookings').select('status').eq('id', ctx.bookingId).single()
    expect(booking?.status).toBe('no_show')
  })

  test('after save, revisiting the detail page shows alreadySubmitted banner', async ({ page }) => {
    // Submit via UI
    await page.goto(`/en/teacher/attendance/${ctx.lessonId}`)
    await expect(page.getByRole('heading', { name: 'Mark Attendance' })).toBeVisible({ timeout: 30000 })
    await page.getByRole('button', { name: new RegExp(ctx.statusPresent.name) }).click()
    await page.getByRole('button', { name: 'Save Attendance' }).click()
    await page.waitForURL(/\/teacher\/attendance(?!\/)/, { timeout: 15000 })

    // Go back to the detail — alreadySubmitted=true, so success banner renders
    await page.goto(`/en/teacher/attendance/${ctx.lessonId}`)
    await expect(page.getByRole('heading', { name: 'Mark Attendance' })).toBeVisible({ timeout: 30000 })
    await expect(page.getByText('Attendance marked successfully')).toBeVisible()
  })
})
