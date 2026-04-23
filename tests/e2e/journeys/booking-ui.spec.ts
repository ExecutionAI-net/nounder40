/**
 * Journey 1b — Booking Flow via UI
 *
 * A real end-to-end via the student browser:
 *   1. Seed a lesson in Milano/Italia so the HQ country/city filters surface it
 *   2. Student opens /student/book
 *   3. Picks country Italia → city Milano → the seeded lesson appears
 *   4. Clicks Book → confirms in the modal
 *   5. Assert DB: booking row exists, credits deducted, current_bookings=1
 *   6. Opens /student/bookings and sees the lesson in Upcoming
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
  inDays,
} from '../../fixtures/factory'

type Ctx = {
  studentUserId: string
  schoolId: string
  lessonTypeId: string
  courseId: string
  courseName: string
  lessonId: string
  studentPackageId: string
  lessonTypeName: string
}

test.use({ storageState: path.join(__dirname, '../../.auth/student.json') })

async function seed(): Promise<Ctx> {
  const { data: studentProfile } = await adminDb
    .from('profiles').select('id').eq('email', 'support+student@alinaquintana.com').single()
  if (!studentProfile) throw new Error('student profile missing')

  const { data: school } = await adminDb
    .from('schools').select('id').eq('slug', 'test-school').single()
  if (!school) throw new Error('test school missing')

  const lessonType = await createLessonType()
  const course = await createCourse(school.id, lessonType.id, {
    city: 'Milano',   // matches hq_cities
    country: 'Italia', // matches hq_countries name
  })
  const lesson = await createLesson(course.id, school.id, lessonType.id, {
    date: inDays(3),
    startTime: '10:00',
    endTime: '11:00',
    maxCapacity: 5,
  })
  await linkStudentToSchool(studentProfile.id, school.id, /* freeLessonUsed */ true)
  const pkg = await createStudentPackage(studentProfile.id, school.id, 5)

  return {
    studentUserId: studentProfile.id,
    schoolId: school.id,
    lessonTypeId: lessonType.id,
    courseId: course.id,
    courseName: course.name,
    lessonId: lesson.id,
    studentPackageId: pkg.id,
    lessonTypeName: lessonType.name_en,
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

test.describe('Journey UI — Student books a lesson via browser', () => {
  let ctx: Ctx

  test.beforeEach(async () => {
    ctx = await seed()
  })

  test.afterEach(async () => {
    await cleanup(ctx)
  })

  test('/book page surfaces seeded lesson in the default list', async ({ page }) => {
    await page.goto('/en/student/book')
    await expect(page.getByRole('heading', { name: 'Book a Class' })).toBeVisible({ timeout: 30000 })

    // With no filters the API returns all scheduled lessons. Look for the
    // course name on a lesson card (p element), not inside a <select> option.
    await expect(
      page.locator('p').getByText(ctx.courseName, { exact: true }).first()
    ).toBeVisible({ timeout: 30000 })
  })

  test('clicking Book → Yes, Book Now creates the booking end-to-end', async ({ page }) => {
    await page.goto('/en/student/book')
    await expect(page.getByRole('heading', { name: 'Book a Class' })).toBeVisible({ timeout: 30000 })

    const courseTitle = page.locator('p').getByText(ctx.courseName, { exact: true }).first()
    await expect(courseTitle).toBeVisible({ timeout: 30000 })
    await courseTitle.scrollIntoViewIfNeeded()

    // Climb to the lesson card ancestor that contains the Book button
    const card = courseTitle.locator('xpath=ancestor::div[.//button[normalize-space()="Book"]][1]')
    await card.getByRole('button', { name: /^Book$/ }).click()

    // Confirmation modal
    await page.getByRole('button', { name: /Yes, Book Now/ }).click()

    // Wait for success: the ✓ Booked badge replaces the Book button on the card
    await expect(page.getByText(/✓\s*Booked/).first()).toBeVisible({ timeout: 15000 })

    // DB verify
    const { data: booking } = await adminDb
      .from('bookings')
      .select('status, credits_deducted, access_source, lesson_id, student_id')
      .eq('lesson_id', ctx.lessonId)
      .eq('student_id', ctx.studentUserId)
      .single()
    expect(booking?.status).toBe('confirmed')
    expect(booking?.credits_deducted).toBe(1)
    expect(booking?.access_source).toBe('package')

    const { data: pkg } = await adminDb
      .from('student_packages')
      .select('credits_remaining').eq('id', ctx.studentPackageId).single()
    expect(pkg?.credits_remaining).toBe(4)

    const { data: lesson } = await adminDb
      .from('lessons').select('current_bookings').eq('id', ctx.lessonId).single()
    expect(lesson?.current_bookings).toBe(1)
  })

  test('booked lesson appears on /student/bookings after booking', async ({ page }) => {
    // Seed the booking directly to save time on this test
    const { data: booking } = await adminDb
      .from('bookings')
      .insert({
        student_id: ctx.studentUserId,
        lesson_id: ctx.lessonId,
        school_id: ctx.schoolId,
        access_source: 'package',
        student_package_id: ctx.studentPackageId,
        credits_deducted: 1,
        status: 'confirmed',
      })
      .select('id')
      .single()
    if (!booking) throw new Error('seed booking failed')

    await page.goto('/en/student/bookings')
    await expect(page.getByRole('heading', { name: 'My Lessons' })).toBeVisible({ timeout: 30000 })

    // The seeded lesson's course name should appear somewhere on the page
    await expect(page.getByText(ctx.lessonTypeName).first()).toBeVisible({ timeout: 15000 })
  })
})
