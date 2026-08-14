import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = admin()
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

  let query = db
    .from('lessons')
    .select(`
      id, date, start_time, end_time, max_capacity, current_bookings, status, notes,
      is_online, online_link,
      school_id, lesson_type_id, teacher_id,
      courses(name, color, credit_cost, min_booking_notice_hours, language, notes, is_online, image_url),
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
    query = query.eq('school_id', schoolId)
  } else if (city || country) {
    // Filter by schools in that city/country
    let schoolQuery = db.from('schools').select('id').eq('active', true)
    if (city) schoolQuery = schoolQuery.ilike('city', `%${city}%`)
    if (country) schoolQuery = schoolQuery.ilike('country', `%${country}%`)

    const { data: schoolsInCity } = await schoolQuery
    if (!schoolsInCity?.length) return NextResponse.json([])

    query = query.in('school_id', schoolsInCity.map((s) => s.id))
  }

  if (to) query = query.lte('date', to)
  if (language) query = query.eq('courses.language', language)
  if (lessonTypeId) query = query.eq('lesson_type_id', lessonTypeId)
  if (teacherId) query = query.eq('teacher_id', teacherId)
  if (isOnline === 'true') query = query.eq('is_online', true)
  if (isOnline === 'false') query = query.eq('is_online', false)

  const { data, error } = await query.limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const res = NextResponse.json(data ?? [])
  res.headers.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=300')
  return res
}
