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
      start_time: '10:00',
      duration_minutes: 60,
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
