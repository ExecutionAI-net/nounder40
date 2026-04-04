import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Get school_id for this user
  const { data: profile } = await supabase
    .from('profiles')
    .select('school_id')
    .eq('id', user.id)
    .single()

  if (!profile?.school_id) return NextResponse.json({ error: 'School not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('school_students')
    .select(`
      id, enrolled_at, free_lesson_used,
      students(id, name, email, phone, city, created_at)
    `)
    .eq('school_id', profile.school_id)
    .order('enrolled_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
