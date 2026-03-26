import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function toDateStr(d: Date) {
  return d.toISOString().split('T')[0]
}

function calcEndTime(startTime: string, durationMinutes: number): string {
  const [h, m] = startTime.split(':').map(Number)
  const total = h * 60 + m + durationMinutes
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
  if (!profile?.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  let query = supabase
    .from('lessons')
    .select(`
      id, date, start_time, end_time, max_capacity, current_bookings, status,
      course_id,
      courses(name, color, credit_cost),
      lesson_types(name_en, name_it),
      teachers(name),
      school_rooms(name, school_locations(name))
    `)
    .eq('school_id', profile.school_id)
    .neq('status', 'cancelled')
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })

  if (from) query = query.gte('date', from)
  if (to) query = query.lte('date', to)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
  if (!profile?.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const schoolId = profile.school_id
  const body = await request.json()

  const {
    lesson_type_id, teacher_id, room_id, name, description,
    frequency, start_date, end_date,
    start_time, duration_minutes, max_capacity, reserve_spots,
    credit_cost, color, vip_booking_hours_before, min_booking_notice_hours,
    waitlist_enabled,
  } = body

  if (!lesson_type_id || !name || !start_date || !start_time || !duration_minutes) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // 1. Create course
  const { data: course, error: courseErr } = await supabase
    .from('courses')
    .insert({
      school_id: schoolId,
      lesson_type_id,
      teacher_id: teacher_id || null,
      room_id: room_id || null,
      name,
      description: description || null,
      frequency: frequency || 'weekly',
      start_date,
      end_date: end_date || null,
      start_time,
      duration_minutes: Number(duration_minutes),
      max_capacity: Number(max_capacity) || 15,
      reserve_spots: Number(reserve_spots) || 0,
      credit_cost: Number(credit_cost) || 1,
      color: color || '#6B1F3A',
      vip_booking_hours_before: Number(vip_booking_hours_before) || 0,
      min_booking_notice_hours: Number(min_booking_notice_hours) || 2,
      waitlist_enabled: waitlist_enabled || false,
    })
    .select()
    .single()

  if (courseErr) return NextResponse.json({ error: courseErr.message }, { status: 500 })

  // 2. Generate lesson instances
  const lessonInserts: object[] = []
  const endTime = calcEndTime(start_time, Number(duration_minutes))
  const startDt = new Date(start_date + 'T12:00:00')

  if (frequency === 'single') {
    lessonInserts.push({
      course_id: course.id, school_id: schoolId,
      teacher_id: teacher_id || null, room_id: room_id || null,
      lesson_type_id, date: start_date,
      start_time, end_time: endTime,
      max_capacity: Number(max_capacity) || 15,
    })
  } else {
    const intervalDays = frequency === 'biweekly' ? 14 : 7
    const endDt = end_date ? new Date(end_date + 'T12:00:00') : addDays(startDt, 365)
    let current = new Date(startDt)

    while (current <= endDt) {
      lessonInserts.push({
        course_id: course.id, school_id: schoolId,
        teacher_id: teacher_id || null, room_id: room_id || null,
        lesson_type_id, date: toDateStr(current),
        start_time, end_time: endTime,
        max_capacity: Number(max_capacity) || 15,
      })
      current = addDays(current, intervalDays)
      if (lessonInserts.length >= 200) break // safety cap
    }
  }

  const { error: lessonsErr } = await supabase.from('lessons').insert(lessonInserts)
  if (lessonsErr) return NextResponse.json({ error: lessonsErr.message }, { status: 500 })

  return NextResponse.json({ id: course.id, lessons_created: lessonInserts.length })
}
