import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { revalidateAll } from '@/lib/revalidate'

// GET: return student's current school
export async function GET() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: student, error } = await supabase
    .from('students')
    .select('school_id, schools(id, name, city, country)')
    .eq('user_id', session.user.id)
    .maybeSingle()

  if (error) console.error('[student/school GET] error:', error.message)
  console.log('[student/school GET] student:', student?.school_id ?? 'none')

  revalidateAll()
  return NextResponse.json({ school: student?.schools ?? null })
}

// POST: set student's school (simple UPDATE on students table)
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { school_id } = await request.json()
  if (!school_id) return NextResponse.json({ error: 'school_id is required' }, { status: 400 })

  console.log('[student/school POST] user:', session.user.id, 'school_id:', school_id)

  const { error } = await supabase
    .from('students')
    .update({ school_id })
    .eq('user_id', session.user.id)

  if (error) {
    console.error('[student/school POST] update error:', error.message)
    revalidateAll()
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  console.log('[student/school POST] success')
  revalidateAll()
  return NextResponse.json({ success: true })
}
