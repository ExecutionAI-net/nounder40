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
    lesson_type_id, teacher_id, name, description,
    waitlist_enabled, reserve_spots,
    // schedules: array of schedule objects (new multi-schedule support)
    // legacy single-schedule fields still supported for backward compat
    schedules,
    // legacy fields
    frequency, start_date, end_date, start_time, duration_minutes,
    max_capacity, credit_cost, color, vip_booking_hours_before, min_booking_notice_hours,
    room_id,
  } = body

  if (!lesson_type_id || !name) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Normalize to schedules array (support both old single and new multi)
  const scheduleList: {
    frequency: string; start_date: string; end_date?: string;
    start_time: string; duration_minutes: number; max_capacity: number;
    credit_cost: number; color: string; vip_booking_hours_before: number;
    min_booking_notice_hours: number; room_id?: string; teacher_id?: string;
  }[] = schedules ?? [{
    frequency: frequency || 'weekly',
    start_date, end_date: end_date || undefined,
    start_time, duration_minutes: Number(duration_minutes),
    max_capacity: Number(max_capacity) || 15,
    credit_cost: Number(credit_cost) || 1,
    color: color || '#6B1F3A',
    vip_booking_hours_before: Number(vip_booking_hours_before) || 0,
    min_booking_notice_hours: Number(min_booking_notice_hours) || 2,
    room_id: room_id || undefined,
    teacher_id: teacher_id || undefined,
  }]

  if (!scheduleList.length || !scheduleList[0].start_date || !scheduleList[0].start_time) {
    return NextResponse.json({ error: 'At least one schedule with start date and time is required' }, { status: 400 })
  }

  // Use first schedule as course template defaults
  const first = scheduleList[0]

  // 1. Create course (using first schedule as defaults)
  const { data: course, error: courseErr } = await supabase
    .from('courses')
    .insert({
      school_id: schoolId,
      lesson_type_id,
      teacher_id: first.teacher_id || teacher_id || null,
      room_id: first.room_id || room_id || null,
      name,
      description: description || null,
      frequency: first.frequency || 'weekly',
      start_date: first.start_date,
      end_date: first.end_date || null,
      start_time: first.start_time,
      duration_minutes: Number(first.duration_minutes),
      max_capacity: Number(first.max_capacity) || 15,
      reserve_spots: Number(reserve_spots) || 0,
      credit_cost: Number(first.credit_cost) || 1,
      color: first.color || '#6B1F3A',
      vip_booking_hours_before: Number(first.vip_booking_hours_before) || 0,
      min_booking_notice_hours: Number(first.min_booking_notice_hours) || 2,
      waitlist_enabled: waitlist_enabled || false,
    })
    .select()
    .single()

  if (courseErr) return NextResponse.json({ error: courseErr.message }, { status: 500 })

  // 2. Generate lesson instances for ALL schedules
  const lessonInserts: object[] = []

  for (const sched of scheduleList) {
    const endTime = calcEndTime(sched.start_time, Number(sched.duration_minutes))
    const startDt = new Date(sched.start_date + 'T12:00:00')
    const teacherId = sched.teacher_id || teacher_id || null
    const roomId = sched.room_id || null

    if (sched.frequency === 'single') {
      lessonInserts.push({
        course_id: course.id, school_id: schoolId,
        teacher_id: teacherId, room_id: roomId,
        lesson_type_id, date: sched.start_date,
        start_time: sched.start_time, end_time: endTime,
        max_capacity: Number(sched.max_capacity) || 15,
      })
    } else {
      const intervalDays = sched.frequency === 'biweekly' ? 14 : 7
      const endDt = sched.end_date ? new Date(sched.end_date + 'T12:00:00') : addDays(startDt, 365)
      let current = new Date(startDt)

      while (current <= endDt && lessonInserts.length < 500) {
        lessonInserts.push({
          course_id: course.id, school_id: schoolId,
          teacher_id: teacherId, room_id: roomId,
          lesson_type_id, date: toDateStr(current),
          start_time: sched.start_time, end_time: endTime,
          max_capacity: Number(sched.max_capacity) || 15,
        })
        current = addDays(current, intervalDays)
      }
    }
  }

  const { error: lessonsErr } = await supabase.from('lessons').insert(lessonInserts)
  if (lessonsErr) return NextResponse.json({ error: lessonsErr.message }, { status: 500 })

  return NextResponse.json({ id: course.id, lessons_created: lessonInserts.length })
}
