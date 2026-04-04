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

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('school_id')
    .eq('id', user.id)
    .single()

  if (!profile?.school_id) return NextResponse.json({ error: 'School not found' }, { status: 404 })

  const db = admin()

  const { data: schoolStudents, error: ssError } = await db
    .from('school_students')
    .select('id, enrolled_at, free_lesson_used, student_id')
    .eq('school_id', profile.school_id)
    .order('enrolled_at', { ascending: false })

  if (ssError) {
    console.error('[school/students] school_students error:', ssError.message)
    return NextResponse.json({ error: ssError.message }, { status: 500 })
  }

  if (!schoolStudents || schoolStudents.length === 0) return NextResponse.json([])

  const studentIds = schoolStudents.map(r => r.student_id)

  const { data: students, error: stError } = await db
    .from('students')
    .select('id, name, email, phone, city, created_at')
    .in('id', studentIds)

  if (stError) {
    console.error('[school/students] students error:', stError.message)
    return NextResponse.json({ error: stError.message }, { status: 500 })
  }

  const studentMap: Record<string, { id: string; name: string; email: string; phone: string | null; city: string | null; created_at: string }> = {}
  for (const s of students ?? []) studentMap[s.id] = s

  const result = schoolStudents.map(r => ({
    id: r.id,
    enrolled_at: r.enrolled_at,
    free_lesson_used: r.free_lesson_used,
    students: studentMap[r.student_id] ?? null,
  }))

  return NextResponse.json(result)
}
