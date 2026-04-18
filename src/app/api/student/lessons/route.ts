import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const city = searchParams.get('city')
  const schoolId = searchParams.get('school_id')
  const from = searchParams.get('from') ?? new Date().toISOString().split('T')[0]
  const to = searchParams.get('to')

  // Find schools in city (if city filter provided)
  let schoolIds: string[] = []
  if (schoolId) {
    schoolIds = [schoolId]
  } else if (city) {
    const { data: schools } = await supabase
      .from('schools')
      .select('id')
      .ilike('city', `%${city}%`)
      .eq('active', true)
    schoolIds = (schools ?? []).map((s) => s.id)
  }

  let query = supabase
    .from('lessons')
    .select(`
      id, date, start_time, end_time, max_capacity, current_bookings, status,
      school_id,
      courses(name, color, credit_cost, min_booking_notice_hours),
      lesson_types(code, name_en),
      teachers(name),
      school_rooms(name, school_locations(name, address)),
      schools(name, city, cancellation_policy_hours)
    `)
    .eq('status', 'scheduled')
    .gte('date', from)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })

  if (schoolIds.length > 0) query = query.in('school_id', schoolIds)
  if (to) query = query.lte('date', to)

  const { data, error } = await query.limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
