import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// GET: return student's current school (if any)
export async function GET() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = admin()
  const { data: student } = await db
    .from('students')
    .select('id')
    .eq('user_id', session.user.id)
    .maybeSingle()

  if (!student) return NextResponse.json({ school: null })

  const { data: link } = await db
    .from('school_students')
    .select('school_id, schools(id, name, city, country)')
    .eq('student_id', student.id)
    .maybeSingle()

  return NextResponse.json({ school: link?.schools ?? null })
}

// POST: set or change school (delete old, insert new)
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { school_id } = await request.json()
  if (!school_id) return NextResponse.json({ error: 'school_id is required' }, { status: 400 })

  const db = admin()

  // Ensure student record exists
  let { data: student } = await db
    .from('students')
    .select('id')
    .eq('user_id', session.user.id)
    .maybeSingle()

  if (!student) {
    const { data: profile } = await db
      .from('profiles')
      .select('name')
      .eq('id', session.user.id)
      .single()

    const { data: newStudent, error: insertErr } = await db
      .from('students')
      .insert({
        user_id: session.user.id,
        name: profile?.name ?? session.user.email!.split('@')[0],
        email: session.user.email!,
      })
      .select('id')
      .single()

    if (insertErr) {
      console.error('student insert error:', insertErr.message)
      return NextResponse.json({ error: 'Failed to create student record: ' + insertErr.message }, { status: 500 })
    }
    student = newStudent
  }

  if (!student) return NextResponse.json({ error: 'Failed to resolve student record' }, { status: 500 })

  // Delete all existing school links for this student (one school at a time)
  await db.from('school_students').delete().eq('student_id', student.id)

  // Insert new link
  const { error } = await db.from('school_students').insert({
    student_id: student.id,
    school_id,
    free_lesson_used: false,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
