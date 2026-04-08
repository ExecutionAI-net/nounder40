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

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
    if (!profile?.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const today = new Date().toISOString().split('T')[0]

    // Cancel future lessons (not past, not already cancelled)
    const { data: futureLessons } = await supabase
      .from('lessons')
      .select('id')
      .eq('course_id', id)
      .eq('school_id', profile.school_id)
      .gte('date', today)
      .neq('status', 'cancelled')

    for (const lesson of futureLessons ?? []) {
      // Refund all confirmed bookings
      const { data: bookings } = await supabase
        .from('bookings')
        .select('id, access_source, student_package_id, student_subscription_id, credits_deducted')
        .eq('lesson_id', lesson.id)
        .eq('status', 'confirmed')

      for (const booking of bookings ?? []) {
        if (booking.access_source === 'package' && booking.student_package_id && booking.credits_deducted > 0) {
          const { data: pkg } = await supabase.from('student_packages').select('credits_remaining').eq('id', booking.student_package_id).single()
          if (pkg) {
            await supabase.from('student_packages').update({ credits_remaining: (pkg.credits_remaining ?? 0) + booking.credits_deducted }).eq('id', booking.student_package_id)
          }
        } else if (booking.access_source === 'subscription' && booking.student_subscription_id) {
          const { data: sub } = await supabase.from('student_subscriptions').select('access_remaining, access_total').eq('id', booking.student_subscription_id).single()
          if (sub && sub.access_remaining !== null) {
            await supabase.from('student_subscriptions').update({ access_remaining: (sub.access_remaining ?? 0) + 1 }).eq('id', booking.student_subscription_id)
          }
        }
        await supabase.from('bookings').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancellation_type: 'within_policy', credit_refunded: true }).eq('id', booking.id)
      }

      await supabase.from('lessons').update({ status: 'cancelled' }).eq('id', lesson.id)
    }

    console.log(`[courses DELETE] course ${id}: ${futureLessons?.length ?? 0} future classes cancelled`)
    return NextResponse.json({ deleted: true, classes_cancelled: futureLessons?.length ?? 0 })
  } catch (err) {
    console.error('[courses DELETE] unexpected', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
