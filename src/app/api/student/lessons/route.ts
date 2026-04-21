import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const city = searchParams.get('city')
  const country = searchParams.get('country')
  const schoolId = searchParams.get('school_id')
  const language = searchParams.get('language')
  const lessonTypeId = searchParams.get('lesson_type_id')
  const teacherId = searchParams.get('teacher_id')
  const isOnline = searchParams.get('is_online')
  const from = searchParams.get('from') ?? new Date().toISOString().split('T')[0]
  const to = searchParams.get('to')

  let query = supabase
    .from('lessons')
    .select(`
      id, date, start_time, end_time, max_capacity, current_bookings, status, notes,
      is_online, online_link,
      school_id, lesson_type_id, teacher_id,
      courses(name, color, credit_cost, min_booking_notice_hours, language, notes, is_online),
      lesson_types(id, code, name_en),
      teachers(id, name),
      school_rooms(name, school_locations(name, address)),
      schools(name, city, cancellation_policy_hours)
    `)
    .eq('status', 'scheduled')
    .gte('date', from)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })

  if (schoolId) {
    // Direct school filter
    query = query.eq('school_id', schoolId)
  } else if (city || country) {
    // Filter by COURSE's country/city (courses have their own location fields)
    let courseQuery = supabase.from('courses').select('id, country, city')
    if (city) courseQuery = courseQuery.ilike('city', `%${city}%`)

    const { data: courses } = await courseQuery
    let matched = courses ?? []

    if (country) {
      const fc = country.toLowerCase()
      matched = matched.filter((c) => {
        const cc = (c.country ?? '').toLowerCase()
        return cc === fc || cc.includes(fc.slice(0, 3))
      })
    }

    if (matched.length === 0) return NextResponse.json([])

    const courseIds = matched.map((c) => c.id)
    query = query.in('course_id', courseIds)
  }

  if (to) query = query.lte('date', to)
  if (language) query = query.eq('courses.language', language)
  if (lessonTypeId) query = query.eq('lesson_type_id', lessonTypeId)
  if (teacherId) query = query.eq('teacher_id', teacherId)
  if (isOnline === 'true') query = query.eq('is_online', true)
  if (isOnline === 'false') query = query.eq('is_online', false)

  const { data, error } = await query.limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
