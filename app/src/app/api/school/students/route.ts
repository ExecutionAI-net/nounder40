import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Get school_id for this user
  const { data: school } = await supabase
    .from('schools')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!school) return NextResponse.json({ error: 'School not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('school_students')
    .select(`
      id, enrolled_at, free_lesson_used,
      students(id, name, email, phone, city, created_at)
    `)
    .eq('school_id', school.id)
    .order('enrolled_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
