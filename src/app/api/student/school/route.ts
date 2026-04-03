import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET: return student's current school (if any)
export async function GET() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: student, error: studentErr } = await supabase
    .from('students')
    .select('id')
    .eq('user_id', session.user.id)
    .maybeSingle()

  if (studentErr) console.error('[student/school GET] student fetch error:', studentErr.message)
  if (!student) return NextResponse.json({ school: null })

  const { data: link, error: linkErr } = await supabase
    .from('school_students')
    .select('school_id, schools(id, name, city, country)')
    .eq('student_id', student.id)
    .maybeSingle()

  if (linkErr) console.error('[student/school GET] school_students fetch error:', linkErr.message)
  return NextResponse.json({ school: link?.schools ?? null })
}

// POST: set or change school (delete old, insert new)
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { school_id } = await request.json()
  if (!school_id) return NextResponse.json({ error: 'school_id is required' }, { status: 400 })

  console.log('[student/school POST] user:', session.user.id, 'school_id:', school_id)

  // Ensure student record exists (user's own session — auth.uid() satisfies RLS)
  let { data: student, error: selectErr } = await supabase
    .from('students')
    .select('id')
    .eq('user_id', session.user.id)
    .maybeSingle()

  if (selectErr) console.error('[student/school POST] student select error:', selectErr.message)
  console.log('[student/school POST] existing student:', student?.id ?? 'none')

  if (!student) {
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('name')
      .eq('id', session.user.id)
      .single()

    if (profileErr) console.error('[student/school POST] profile fetch error:', profileErr.message)

    const { data: newStudent, error: insertErr } = await supabase
      .from('students')
      .insert({
        user_id: session.user.id,
        name: profile?.name ?? session.user.email!.split('@')[0],
        email: session.user.email!,
      })
      .select('id')
      .single()

    if (insertErr) {
      console.error('[student/school POST] student insert error:', insertErr.message)
      return NextResponse.json({ error: 'Failed to create student: ' + insertErr.message }, { status: 500 })
    }
    console.log('[student/school POST] created student:', newStudent?.id)
    student = newStudent
  }

  if (!student) {
    console.error('[student/school POST] student is null after insert attempt')
    return NextResponse.json({ error: 'Failed to resolve student record' }, { status: 500 })
  }

  // Delete existing school links for this student
  const { error: deleteErr } = await supabase
    .from('school_students')
    .delete()
    .eq('student_id', student.id)

  if (deleteErr) console.error('[student/school POST] delete school_students error:', deleteErr.message)

  // Insert new school link
  const { error: insertSchoolErr } = await supabase.from('school_students').insert({
    student_id: student.id,
    school_id,
    free_lesson_used: false,
  })

  if (insertSchoolErr) {
    console.error('[student/school POST] school_students insert error:', insertSchoolErr.message, 'student_id:', student.id, 'school_id:', school_id)
    return NextResponse.json({ error: insertSchoolErr.message }, { status: 500 })
  }

  console.log('[student/school POST] success, student:', student.id, '-> school:', school_id)
  return NextResponse.json({ success: true })
}
