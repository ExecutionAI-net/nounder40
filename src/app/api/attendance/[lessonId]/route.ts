import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET: list of booked students for a lesson + existing attendance
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ lessonId: string }> }
) {
  const { lessonId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: teacher } = await supabase
    .from('teachers')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!teacher) return NextResponse.json({ error: 'Teacher not found' }, { status: 404 })

  // Verify this lesson belongs to this teacher
  const { data: lesson } = await supabase
    .from('lessons')
    .select('id, date, start_time, status, teacher_id, courses(name), school_rooms(name)')
    .eq('id', lessonId)
    .eq('teacher_id', teacher.id)
    .single()

  if (!lesson) return NextResponse.json({ error: 'Lesson not found' }, { status: 404 })

  // Get confirmed bookings
  const { data: bookings } = await supabase
    .from('bookings')
    .select('id, student_id, access_source')
    .eq('lesson_id', lessonId)
    .in('status', ['confirmed', 'attended', 'no_show'])

  // Fetch student profiles manually (no FK on bookings.student_id)
  const studentIds = (bookings ?? []).map(b => b.student_id)
  const { data: profiles } = studentIds.length > 0
    ? await supabase.from('profiles').select('id, name, email').in('id', studentIds)
    : { data: [] }

  const profileMap: Record<string, { name: string; email: string }> = {}
  for (const p of profiles ?? []) {
    profileMap[p.id] = { name: p.name, email: p.email }
  }

  // Get existing attendance records
  const { data: attendance } = await supabase
    .from('attendance')
    .select('booking_id, status')
    .eq('lesson_id', lessonId)

  const attendanceMap: Record<string, string> = {}
  for (const a of attendance ?? []) {
    attendanceMap[a.booking_id] = a.status
  }

  return NextResponse.json({
    lesson,
    bookings: (bookings ?? []).map(b => ({
      ...b,
      profiles: profileMap[b.student_id] ?? null,
      attendance_status: attendanceMap[b.id] ?? null,
    })),
    already_submitted: (attendance ?? []).length > 0,
  })
}

// POST: submit attendance for a lesson
export async function POST(
  request: Request,
  { params }: { params: Promise<{ lessonId: string }> }
) {
  const { lessonId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: teacher } = await supabase
    .from('teachers')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!teacher) return NextResponse.json({ error: 'Teacher not found' }, { status: 404 })

  // Verify lesson belongs to teacher
  const { data: lesson } = await supabase
    .from('lessons')
    .select('id, status, teacher_id')
    .eq('id', lessonId)
    .eq('teacher_id', teacher.id)
    .single()

  if (!lesson) return NextResponse.json({ error: 'Lesson not found' }, { status: 404 })

  // Check not already submitted
  const { data: existing } = await supabase
    .from('attendance')
    .select('id')
    .eq('lesson_id', lessonId)
    .limit(1)
    .maybeSingle()

  if (existing) return NextResponse.json({ error: 'Attendance already submitted' }, { status: 400 })

  // Body: { attendance: [{ booking_id, student_id, status: 'present' | 'no_show' }] }
  const body = await request.json()
  const records: { booking_id: string; student_id: string; status: 'present' | 'no_show' }[] = body.attendance

  if (!records || records.length === 0) {
    return NextResponse.json({ error: 'No attendance records provided' }, { status: 400 })
  }

  // Insert attendance records
  const { error: insertErr } = await supabase.from('attendance').insert(
    records.map(r => ({
      lesson_id: lessonId,
      booking_id: r.booking_id,
      student_id: r.student_id,
      teacher_id: teacher.id,
      status: r.status,
    }))
  )

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  // Update booking statuses
  const presentIds = records.filter(r => r.status === 'present').map(r => r.booking_id)
  const noShowIds = records.filter(r => r.status === 'no_show').map(r => r.booking_id)

  if (presentIds.length > 0) {
    await supabase.from('bookings').update({ status: 'attended' }).in('id', presentIds)
  }

  if (noShowIds.length > 0) {
    await supabase.from('bookings').update({ status: 'no_show' }).in('id', noShowIds)

    // Burn credits/accesses for no-shows
    for (const bookingId of noShowIds) {
      const { data: booking } = await supabase
        .from('bookings')
        .select('access_source, student_package_id, student_subscription_id, credits_deducted')
        .eq('id', bookingId)
        .single()

      if (!booking) continue

      // No-show: credits already deducted on booking. Nothing to restore.
      // But if access_source is free_lesson with credits_deducted = 0, nothing to do.
    }
  }

  // Mark lesson as completed
  await supabase.from('lessons').update({ status: 'completed' }).eq('id', lessonId)

  return NextResponse.json({ submitted: true, present: presentIds.length, no_show: noShowIds.length })
}
