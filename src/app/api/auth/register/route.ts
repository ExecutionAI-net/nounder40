import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(request: Request) {
  const { userId, name, email, phone, date_of_birth, city, country, school_id } = await request.json()

  if (!userId || !name || !email) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const db = admin()

  // Trigger auto-creates profile on signUp; just update with the name/email/role.
  // phone, date_of_birth, city, country live in the students table, not profiles.
  const { error: profileError } = await db
    .from('profiles')
    .update({ name, email, role: 'student' })
    .eq('id', userId)

  // If update affected 0 rows (trigger hadn't fired yet), insert manually
  if (profileError) {
    const { error: insertError } = await db.from('profiles').insert({
      id: userId,
      name,
      email,
      role: 'student',
    })
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }
  }

  // Ensure student record exists (some queries use students table)
  const { data: existingStudent } = await db.from('students').select('id').eq('user_id', userId).single()
  if (!existingStudent) {
    await db.from('students').insert({ user_id: userId, name, email, phone: phone || null, date_of_birth: date_of_birth || null, city: city || null, country })
  }

  // Link student to school if provided
  if (school_id) {
    const { data: student } = await db.from('students').select('id').eq('user_id', userId).single()
    if (student) {
      await db.from('school_students').upsert({
        school_id,
        student_id: student.id,
        free_lesson_used: false,
      }, { onConflict: 'school_id,student_id', ignoreDuplicates: true })
    }
  }

  return NextResponse.json({ success: true })
}
