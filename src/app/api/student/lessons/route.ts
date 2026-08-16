import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getShowTeacherMap } from '@/lib/school-visibility'
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
  // Catalogo pubblico: consultabile anche senza login (la prenotazione resta
  // protetta da /api/bookings). Per gli anonimi si oscura il link online.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const db = admin()
  const { searchParams } = new URL(request.url)
  // i filtri arrivano come liste CSV (multiselezione lato client)
  const csv = (v: string | null) => (v ?? '').split(',').map(x => x.trim()).filter(Boolean)
  const cities = csv(searchParams.get('city'))
  const countries = csv(searchParams.get('country'))
  const schoolIds = csv(searchParams.get('school_id'))
  const languages = csv(searchParams.get('language'))
  const lessonTypeIds = csv(searchParams.get('lesson_type_id'))
  const teacherIds = csv(searchParams.get('teacher_id'))
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
      lesson_types!inner(id, code, level, name_en, name_it, name_fr, name_es, description_it, description_en, description_fr, description_es, image_url, image_url_it, image_url_en, image_url_fr, image_url_es, video_url_it, video_url_en, video_url_fr, video_url_es, active),
      teachers(id, name, photo_url),
      school_rooms(name, school_locations(name, address, google_maps_url)),
      schools(name, city, cancellation_policy_hours)
    `)
    .eq('status', 'scheduled')
    .eq('lesson_types.active', true)
    .gte('date', from)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })

  if (schoolIds.length > 0) {
    query = query.in('school_id', schoolIds)
  } else if (cities.length > 0 || countries.length > 0) {
    // Scuole attive che corrispondono ad ALMENO una città/paese selezionato
    const { data: activeSchools } = await db.from('schools').select('id, city, country').eq('active', true)
    const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase()
    const citySet = new Set(cities.map(norm))
    const countrySet = new Set(countries.map(norm))
    const matched = (activeSchools ?? []).filter((sc) => {
      if (citySet.size > 0 && !citySet.has(norm(sc.city))) return false
      if (countrySet.size > 0 && citySet.size === 0 && !countrySet.has(norm(sc.country))) return false
      return true
    })
    if (!matched.length) return NextResponse.json([])

    query = query.in('school_id', matched.map((s) => s.id))
  }

  if (to) query = query.lte('date', to)
  if (languages.length > 0) query = query.in('courses.language', languages)
  if (lessonTypeIds.length > 0) query = query.in('lesson_type_id', lessonTypeIds)
  if (teacherIds.length > 0) query = query.in('teacher_id', teacherIds)
  if (isOnline === 'true') query = query.eq('is_online', true)
  if (isOnline === 'false') query = query.eq('is_online', false)

  const { data, error } = await query.limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Il link della lezione online NON si espone mai in fase di ricerca:
  // lo vede solo chi ha prenotato (Le mie lezioni + email di conferma)
  // Insegnante oscurato per le scuole che lo nascondono alle allieve.
  const showTeacher = await getShowTeacherMap((data ?? []).map((l) => l.school_id))
  const rows = (data ?? []).map((l) => ({
    ...l,
    online_link: null,
    ...(showTeacher[l.school_id] === false ? { teachers: null, teacher_id: null } : {}),
  }))
  const res = NextResponse.json(rows)
  res.headers.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=300')
  return res
}
