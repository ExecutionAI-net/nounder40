import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.test')
}

export const adminDb = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ── Cleanup helpers ───────────────────────────────────────────────────────────

/** Delete all rows whose name/slug/email starts with 'e2e-' */
export async function cleanupTestData() {
  await adminDb.from('bookings').delete().like('id', '%')  // via cascade from lessons
  await adminDb.from('lessons').delete().in(
    'course_id',
    (await adminDb.from('courses').select('id').like('name', 'e2e-%')).data?.map(r => r.id) ?? []
  )
  await adminDb.from('courses').delete().like('name', 'e2e-%')
  await adminDb.from('school_locations').delete().like('name', 'e2e-%')
  await adminDb.from('schools').delete().like('name', 'e2e-%')
  await adminDb.from('lesson_types').delete().like('name_en', 'e2e-%')
  await adminDb.from('packages').delete().like('name_en', 'e2e-%')
}

/** Delete a specific school and all its data by name prefix */
export async function deleteSchool(namePrefix: string) {
  const { data: schools } = await adminDb
    .from('schools')
    .select('id')
    .like('name', `${namePrefix}%`)

  if (!schools?.length) return

  for (const school of schools) {
    await adminDb.from('courses').delete().eq('school_id', school.id)
    await adminDb.from('school_locations').delete().eq('school_id', school.id)
    await adminDb.from('packages').delete().eq('school_id', school.id)
  }

  await adminDb.from('schools').delete().like('name', `${namePrefix}%`)
}
