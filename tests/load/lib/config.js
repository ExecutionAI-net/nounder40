/**
 * Shared k6 config & helpers.
 * k6 exposes env vars via __ENV.
 */

export const BASE_URL = __ENV.BASE_URL ?? 'http://localhost:3000'
export const SUPABASE_URL = __ENV.SUPABASE_URL ?? 'https://dtbtanjlwlgkganrzxuw.supabase.co'
export const ANON_KEY = __ENV.ANON_KEY ?? 'sb_publishable_Wvdubv53WgkirZJG_BbcZA_zWWp3V6o'

// Seeded via tests/load/seed.mjs
export const LOAD_LESSON_ID = __ENV.LOAD_LESSON_ID ?? ''
export const LOAD_STUDENT_COUNT = Number(__ENV.LOAD_STUDENT_COUNT ?? 20)

// Password used for every seeded student
export const LOAD_PASSWORD = 'LoadTest123!'

export function studentEmail(i) {
  // Must match the seed script's pattern
  return `loadtest+s${i}@alinaquintana.com`
}
