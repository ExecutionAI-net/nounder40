import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

function calcEndTime(startTime: string, durationMinutes: number): string {
  const [h, m] = startTime.split(':').map(Number)
  const total = h * 60 + m + durationMinutes
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
  if (!profile?.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: course, error } = await supabase
    .from('courses')
    .select('*')
    .eq('id', id)
    .eq('school_id', profile.school_id)
    .single()

  if (error || !course) return NextResponse.json({ error: 'Course not found' }, { status: 404 })
  return NextResponse.json(course)
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
  if (!profile?.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const schoolId = profile.school_id
  const body = await request.json()

  const {
    lesson_type_id, teacher_id, room_id, name, description,
    start_time, duration_minutes, max_capacity, reserve_spots,
    credit_cost, color, vip_booking_hours_before, min_booking_notice_hours,
    waitlist_enabled,
    update_future_lessons,
  } = body

  if (!lesson_type_id || !name || !start_time || !duration_minutes) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Update course
  const { data: course, error: courseErr } = await supabase
    .from('courses')
    .update({
      lesson_type_id,
      teacher_id: teacher_id || null,
      room_id: room_id || null,
      name,
      description: description || null,
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
    .eq('id', id)
    .eq('school_id', schoolId)
    .select()
    .single()

  if (courseErr || !course) {
    console.error('[courses PUT] course update error:', courseErr?.message)
    return NextResponse.json({ error: courseErr?.message ?? 'Update failed' }, { status: 500 })
  }

  // Optionally update future (not yet started) lessons
  if (update_future_lessons) {
    const today = new Date().toISOString().split('T')[0]
    const endTime = calcEndTime(start_time, Number(duration_minutes))

    const { error: lessonsErr } = await supabase
      .from('lessons')
      .update({
        teacher_id: teacher_id || null,
        room_id: room_id || null,
        lesson_type_id,
        start_time,
        end_time: endTime,
        max_capacity: Number(max_capacity) || 15,
      })
      .eq('course_id', id)
      .eq('school_id', schoolId)
      .gte('date', today)
      .neq('status', 'cancelled')

    if (lessonsErr) {
      console.error('[courses PUT] lessons update error:', lessonsErr.message)
    }
  }

  return NextResponse.json({ id: course.id })
}
