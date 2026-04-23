/**
 * Test data factories.
 * All generated names are prefixed with 'e2e-' so cleanup scripts can target them safely.
 */

import { adminDb } from '../helpers/db'

let seq = Date.now()
function uid() {
  return (seq++).toString(36)
}

// ── Schools ───────────────────────────────────────────────────────────────────

export interface TestSchool {
  id: string
  name: string
  slug: string
}

export async function createSchool(overrides: Partial<{
  name: string
  slug: string
  city: string
  country: string
}> = {}): Promise<TestSchool> {
  const id = uid()
  const name = overrides.name ?? `e2e-school-${id}`
  const slug = overrides.slug ?? `e2e-school-${id}`

  const { data, error } = await adminDb
    .from('schools')
    .insert({
      name,
      slug,
      email: `e2e-school-${id}@test.local`,
      city: overrides.city ?? 'Milan',
      country: overrides.country ?? 'IT',
      active: true,
      platform_fee_percentage: 10,
    })
    .select('id, name, slug')
    .single()

  if (error) throw new Error(`createSchool failed: ${error.message}`)
  return data as TestSchool
}

export async function deleteSchoolById(id: string) {
  await adminDb.from('courses').delete().eq('school_id', id)
  await adminDb.from('school_locations').delete().eq('school_id', id)
  await adminDb.from('packages').delete().eq('school_id', id)
  await adminDb.from('schools').delete().eq('id', id)
}

// ── Lesson types ──────────────────────────────────────────────────────────────

export interface TestLessonType {
  id: string
  code: string
  name_en: string
}

export async function createLessonType(overrides: Partial<{
  code: string
  name_en: string
  level: string
}> = {}): Promise<TestLessonType> {
  const id = uid()
  const code = overrides.code ?? `E2E-${id}`
  const name_en = overrides.name_en ?? `e2e-lesson-type-${id}`

  const { data, error } = await adminDb
    .from('lesson_types')
    .insert({
      code,
      name_en,
      name_it: name_en,
      name_fr: name_en,
      name_es: name_en,
      level: overrides.level ?? 'all',
      active: true,
    })
    .select('id, code, name_en')
    .single()

  if (error) throw new Error(`createLessonType failed: ${error.message}`)
  return data as TestLessonType
}

// ── Courses ───────────────────────────────────────────────────────────────────

export interface TestCourse {
  id: string
  name: string
}

export async function createCourse(
  schoolId: string,
  lessonTypeId: string,
  overrides: Partial<{ name: string; maxCapacity: number }> = {}
): Promise<TestCourse> {
  const id = uid()
  const name = overrides.name ?? `e2e-course-${id}`

  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await adminDb
    .from('courses')
    .insert({
      name,
      school_id: schoolId,
      lesson_type_id: lessonTypeId,
      max_capacity: overrides.maxCapacity ?? 10,
      credit_cost: 1,
      active: true,
      frequency: 'single',
      start_date: today,
      start_time: '10:00',
      duration_minutes: 60,
      min_booking_notice_hours: 2,
      vip_booking_hours_before: 0,
    })
    .select('id, name')
    .single()

  if (error) throw new Error(`createCourse failed: ${error.message}`)
  return data as TestCourse
}

// ── Packages ──────────────────────────────────────────────────────────────────

export interface TestPackage {
  id: string
  name_en: string
}

// ── Lessons ───────────────────────────────────────────────────────────────────

export interface TestLesson {
  id: string
  date: string
  start_time: string
}

/** Tomorrow in YYYY-MM-DD (local clock). */
export function tomorrow(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** A date guaranteed to be more than 24h away (default cancellation policy). */
export function inDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export async function createLesson(
  courseId: string,
  schoolId: string,
  lessonTypeId: string,
  overrides: Partial<{
    date: string
    startTime: string
    endTime: string
    teacherId: string
    maxCapacity: number
  }> = {}
): Promise<TestLesson> {
  const row = {
    course_id: courseId,
    school_id: schoolId,
    lesson_type_id: lessonTypeId,
    teacher_id: overrides.teacherId ?? null,
    date: overrides.date ?? tomorrow(),
    start_time: overrides.startTime ?? '10:00',
    end_time: overrides.endTime ?? '11:00',
    max_capacity: overrides.maxCapacity ?? 10,
    current_bookings: 0,
    status: 'scheduled',
  }
  const { data, error } = await adminDb
    .from('lessons')
    .insert(row)
    .select('id, date, start_time')
    .single()
  if (error) throw new Error(`createLesson failed: ${error.message}`)
  return data as TestLesson
}

// ── Student packages (credits wallet) ─────────────────────────────────────────

export interface TestStudentPackage {
  id: string
  credits_remaining: number
}

export async function createStudentPackage(
  studentUserId: string,
  schoolId: string,
  credits: number = 5,
  packageId: string | null = null
): Promise<TestStudentPackage> {
  const now = new Date()
  const expires = new Date(now)
  expires.setDate(expires.getDate() + 90)

  const { data, error } = await adminDb
    .from('student_packages')
    .insert({
      student_id: studentUserId,
      school_id: schoolId,
      package_id: packageId,
      credits_total: credits,
      credits_remaining: credits,
      purchased_at: now.toISOString(),
      expires_at: expires.toISOString(),
      payment_method: 'manual',
      status: 'active',
    })
    .select('id, credits_remaining')
    .single()
  if (error) throw new Error(`createStudentPackage failed: ${error.message}`)
  return data as TestStudentPackage
}

/** Ensure `school_students` row exists (needed for free-lesson + cancellation logic). */
export async function linkStudentToSchool(studentUserId: string, schoolId: string, freeLessonUsed: boolean = true) {
  const { data: existing } = await adminDb
    .from('school_students')
    .select('id')
    .eq('student_id', studentUserId)
    .eq('school_id', schoolId)
    .maybeSingle()
  if (existing) return existing.id

  const { data, error } = await adminDb
    .from('school_students')
    .insert({
      student_id: studentUserId,
      school_id: schoolId,
      free_lesson_used: freeLessonUsed,
    })
    .select('id')
    .single()
  if (error) throw new Error(`linkStudentToSchool failed: ${error.message}`)
  return data.id
}

// ── Packages (school catalog) ─────────────────────────────────────────────────

export async function createPackage(
  schoolId: string,
  overrides: Partial<{ name: string; credits: number; price: number }> = {}
): Promise<TestPackage> {
  const id = uid()
  const name_en = overrides.name ?? `e2e-package-${id}`

  const { data, error } = await adminDb
    .from('packages')
    .insert({
      school_id: schoolId,
      name_en,
      name_it: name_en,
      name_fr: name_en,
      name_es: name_en,
      credits: overrides.credits ?? 5,
      validity_days: 90,
      price: overrides.price ?? 50,
      lesson_type_restriction: 'all',
      active: true,
    })
    .select('id, name_en')
    .single()

  if (error) throw new Error(`createPackage failed: ${error.message}`)
  return data as TestPackage
}
