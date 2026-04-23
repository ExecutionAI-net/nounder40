/**
 * Journey 7 — Free first lesson
 *
 * Schools can offer a free first lesson per student. The booking API tracks
 * this via school_students.free_lesson_used:
 *
 *   - When free_lesson_used = false, the next booking uses access_source='free_lesson'
 *     and credits_deducted = 0 (no credits taken even if the student has credits)
 *   - free_lesson_used flips to true after that booking
 *   - Subsequent bookings fall through to package/subscription as normal
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
  schoolId: string
  lessonTypeId: string
  courseId: string
  lesson1Id: string
  lesson2Id: string
  studentPackageId: string
}

const STUDENT_AUTH = path.join(__dirname, '../../.auth/student.json')

async function seed(): Promise<Ctx> {
  const { data: studentProfile } = await adminDb
    .from('profiles').select('id').eq('email', 'support+student@alinaquintana.com').single()
  if (!studentProfile) throw new Error('student profile missing')

  const { data: school } = await adminDb
    .from('schools').select('id').eq('slug', 'test-school').single()
  if (!school) throw new Error('test school missing')

  const lessonType = await createLessonType()
  const course = await createCourse(school.id, lessonType.id)
  const lesson1 = await createLesson(course.id, school.id, lessonType.id, {
    date: inDays(3), startTime: '10:00', endTime: '11:00', maxCapacity: 5,
  })
  const lesson2 = await createLesson(course.id, school.id, lessonType.id, {
    date: inDays(4), startTime: '10:00', endTime: '11:00', maxCapacity: 5,
  })

  // Link student with free_lesson_used = false (i.e. unused) for this journey
  await adminDb
    .from('school_students').delete().eq('student_id', studentProfile.id).eq('school_id', school.id)
  await linkStudentToSchool(studentProfile.id, school.id, /* freeLessonUsed */ false)

  const pkg = await createStudentPackage(studentProfile.id, school.id, 5)

  return {
    studentUserId: studentProfile.id,
    schoolId: school.id,
    lessonTypeId: lessonType.id,
    courseId: course.id,
    lesson1Id: lesson1.id,
    lesson2Id: lesson2.id,
    studentPackageId: pkg.id,
  }
}

async function cleanup(ctx: Partial<Ctx>) {
  if (ctx.lesson1Id) {
    await adminDb.from('bookings').delete().eq('lesson_id', ctx.lesson1Id)
    await adminDb.from('lessons').delete().eq('id', ctx.lesson1Id)
  }
  if (ctx.lesson2Id) {
    await adminDb.from('bookings').delete().eq('lesson_id', ctx.lesson2Id)
    await adminDb.from('lessons').delete().eq('id', ctx.lesson2Id)
  }
  if (ctx.courseId) await adminDb.from('courses').delete().eq('id', ctx.courseId)
  if (ctx.studentPackageId) await adminDb.from('student_packages').delete().eq('id', ctx.studentPackageId)
  if (ctx.lessonTypeId) await adminDb.from('lesson_types').delete().eq('id', ctx.lessonTypeId)
  // Restore default free_lesson_used=true for other test suites
  if (ctx.studentUserId && ctx.schoolId) {
    await adminDb.from('school_students')
      .update({ free_lesson_used: true })
      .eq('student_id', ctx.studentUserId)
      .eq('school_id', ctx.schoolId)
  }
}

test.describe('Journey — Free first lesson', () => {
  let ctx: Ctx

  test.beforeEach(async () => {
    ctx = await seed()
  })

  test.afterEach(async () => {
    await cleanup(ctx)
  })

  test('first booking for a fresh student uses free_lesson, no credits deducted', async () => {
    const student = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: STUDENT_AUTH,
    })

    const res = await student.post('/api/bookings', {
      data: { lesson_id: ctx.lesson1Id },
    })
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.access_source).toBe('free_lesson')

    // Booking row matches
    const { data: booking } = await adminDb
      .from('bookings')
      .select('access_source, credits_deducted, student_package_id, status')
      .eq('id', body.id)
      .single()
    expect(booking?.access_source).toBe('free_lesson')
    expect(booking?.credits_deducted).toBe(0)
    expect(booking?.student_package_id).toBeNull()
    expect(booking?.status).toBe('confirmed')

    // Package untouched — student still has all 5 credits
    const { data: pkg } = await adminDb
      .from('student_packages').select('credits_remaining').eq('id', ctx.studentPackageId).single()
    expect(pkg?.credits_remaining).toBe(5)

    // school_students.free_lesson_used flipped to true
    const { data: link } = await adminDb
      .from('school_students')
      .select('free_lesson_used')
      .eq('student_id', ctx.studentUserId)
      .eq('school_id', ctx.schoolId)
      .single()
    expect(link?.free_lesson_used).toBe(true)

    await student.dispose()
  })

  test('second booking falls through to package (credits deducted normally)', async () => {
    const student = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: STUDENT_AUTH,
    })

    // First booking consumes the free slot
    await student.post('/api/bookings', { data: { lesson_id: ctx.lesson1Id } })

    // Second booking on a different lesson should use a credit
    const res = await student.post('/api/bookings', {
      data: { lesson_id: ctx.lesson2Id },
    })
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.access_source).toBe('package')

    // Package: 5 → 4
    const { data: pkg } = await adminDb
      .from('student_packages').select('credits_remaining').eq('id', ctx.studentPackageId).single()
    expect(pkg?.credits_remaining).toBe(4)

    await student.dispose()
  })
})
