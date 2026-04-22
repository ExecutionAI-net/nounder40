import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Find teacher record
  const { data: teacher } = await supabase
    .from('teachers')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!teacher) return NextResponse.json({ error: 'Teacher not found' }, { status: 404 })

  const today = new Date().toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('lessons')
    .select(`
      id, date, start_time, end_time, status, current_bookings, max_capacity,
      courses(name, color),
      lesson_types(name_en),
      school_rooms(name, school_locations(name)),
      schools(name, city)
    `)
    .eq('teacher_id', teacher.id)
    .gte('date', today)
    .in('status', ['scheduled', 'completed'])
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const res = NextResponse.json({ teacherId: teacher.id, lessons: data ?? [] })
  res.headers.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=300')
  return res
}
