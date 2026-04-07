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
    .select('id, date, start_time, status, teacher_id, school_id, courses(name), school_rooms(name)')
    .eq('id', lessonId)
    .eq('teacher_id', teacher.id)
    .single()

  if (!lesson) return NextResponse.json({ error: 'Lesson not found' }, { status: 404 })

  // Get attendance statuses for this school
  const { data: statuses } = await supabase
    .from('attendance_statuses')
    .select('id, name, color, burns_credit, is_default, sort_order')
    .eq('school_id', lesson.school_id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

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
    .select('booking_id, status, status_id')
    .eq('lesson_id', lessonId)

  const attendanceMap: Record<string, { status: string; status_id: string | null }> = {}
  for (const a of attendance ?? []) {
    attendanceMap[a.booking_id] = { status: a.status, status_id: a.status_id }
  }

  return NextResponse.json({
    lesson,
    statuses: statuses ?? [],
    bookings: (bookings ?? []).map(b => ({
      ...b,
      profiles: profileMap[b.student_id] ?? null,
      attendance_status: attendanceMap[b.id]?.status ?? null,
      attendance_status_id: attendanceMap[b.id]?.status_id ?? null,
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
    .select('id, status, teacher_id, school_id')
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

  // Body: { attendance: [{ booking_id, student_id, status_id }] }
  const body = await request.json()
  const records: { booking_id: string; student_id: string; status_id: string }[] = body.attendance

  if (!records || records.length === 0) {
    return NextResponse.json({ error: 'No attendance records provided' }, { status: 400 })
  }

  // Fetch all status definitions for this school to determine burns_credit
  const statusIds = [...new Set(records.map(r => r.status_id))]
  const { data: statusDefs } = await supabase
    .from('attendance_statuses')
    .select('id, name, burns_credit')
    .eq('school_id', lesson.school_id)
    .in('id', statusIds)

  const statusMap: Record<string, { name: string; burns_credit: boolean }> = {}
  for (const s of statusDefs ?? []) {
    statusMap[s.id] = { name: s.name, burns_credit: s.burns_credit }
  }

  // Insert attendance records
  const { error: insertErr } = await supabase.from('attendance').insert(
    records.map(r => ({
      lesson_id: lessonId,
      booking_id: r.booking_id,
      student_id: r.student_id,
      teacher_id: teacher.id,
      status_id: r.status_id,
      // Keep legacy status column for backward compat
      status: statusMap[r.status_id]?.burns_credit ? 'present' : 'no_show',
    }))
  )

  if (insertErr) {
    console.error('[attendance POST] insert error', insertErr)
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  // Process credit burn based on burns_credit flag
  const burnsIds = records.filter(r => statusMap[r.status_id]?.burns_credit).map(r => r.booking_id)
  const noburnsIds = records.filter(r => !statusMap[r.status_id]?.burns_credit).map(r => r.booking_id)

  if (burnsIds.length > 0) {
    await supabase.from('bookings').update({ status: 'attended' }).in('id', burnsIds)
  }

  if (noburnsIds.length > 0) {
    // No credit burn: mark as no_show in bookings but don't deduct
    await supabase.from('bookings').update({ status: 'no_show' }).in('id', noburnsIds)
  }

  // Mark lesson as completed
  await supabase.from('lessons').update({ status: 'completed' }).eq('id', lessonId)

  console.log(`[attendance POST] lesson ${lessonId} submitted: ${burnsIds.length} credit-burn, ${noburnsIds.length} no-burn`)

  return NextResponse.json({
    submitted: true,
    credit_burned: burnsIds.length,
    no_burn: noburnsIds.length,
  })
}
