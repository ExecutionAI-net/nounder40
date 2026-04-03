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

  const name = session.user.user_metadata?.name ?? session.user.email!.split('@')[0]

  // Single atomic RPC: get-or-create student + link to school (SECURITY DEFINER bypasses RLS)
  const { data: studentId, error: rpcErr } = await supabase.rpc('link_student_to_school', {
    p_user_id:   session.user.id,
    p_email:     session.user.email!,
    p_name:      name,
    p_school_id: school_id,
  })

  if (rpcErr) {
    console.error('[student/school POST] rpc error:', rpcErr.message)
    return NextResponse.json({ error: rpcErr.message }, { status: 500 })
  }

  console.log('[student/school POST] success, student_id:', studentId, '-> school:', school_id)
  return NextResponse.json({ success: true })
}
