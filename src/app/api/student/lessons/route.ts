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
  const from = searchParams.get('from') ?? new Date().toISOString().split('T')[0]
  const to = searchParams.get('to')

  // Find schools matching country/city filters
  let schoolIds: string[] = []
  const hasLocationFilter = !!(schoolId || city || country)

  if (schoolId) {
    schoolIds = [schoolId]
  } else if (city || country) {
    let schoolQuery = supabase.from('schools').select('id, country').eq('active', true)
    if (city) schoolQuery = schoolQuery.ilike('city', `%${city}%`)

    const { data: schools } = await schoolQuery
    let matched = schools ?? []

    // Country filter: match by full name OR ISO code (handles legacy data)
    if (country) {
      matched = matched.filter((s) => {
        const sc = (s.country ?? '').toLowerCase()
        const fc = country.toLowerCase()
        return sc === fc || sc.startsWith(fc.slice(0, 2))
      })
    }

    schoolIds = matched.map((s) => s.id)
  }

  // If a location filter was applied but no schools matched, return empty
  if (hasLocationFilter && !schoolId && schoolIds.length === 0) {
    return NextResponse.json([])
  }

  let query = supabase
    .from('lessons')
    .select(`
      id, date, start_time, end_time, max_capacity, current_bookings, status,
      school_id,
      courses(name, color, credit_cost, min_booking_notice_hours, language),
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
  if (language) query = query.eq('courses.language', language)

  const { data, error } = await query.limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
