import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// GET: booked students + attendance statuses + existing attendance for a lesson
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ lessonId: string }> }
) {
  const { lessonId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('school_id')
    .eq('id', user.id)
    .single()

  if (!profile?.school_id) return NextResponse.json({ error: 'School not found' }, { status: 404 })

  const schoolId = profile.school_id

  // Verify lesson belongs to this school
  const { data: lesson } = await supabase
    .from('lessons')
    .select('id, date, start_time, status, teacher_id, school_id, courses(name), school_rooms(name)')
    .eq('id', lessonId)
    .eq('school_id', schoolId)
    .single()

  if (!lesson) return NextResponse.json({ error: 'Lesson not found' }, { status: 404 })

  // Attendance statuses for this school
  const { data: statuses } = await supabase
    .from('attendance_statuses')
    .select('id, name, color, burns_credit, is_default, sort_order')
    .eq('school_id', schoolId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  // Confirmed bookings for this lesson
  const { data: bookings } = await supabase
    .from('bookings')
    .select('id, student_id, access_source')
    .eq('lesson_id', lessonId)
    .in('status', ['confirmed', 'attended', 'no_show'])

  // Student profiles
  const studentIds = (bookings ?? []).map(b => b.student_id)
  const { data: profiles } = studentIds.length > 0
    ? await supabase.from('profiles').select('id, name, email').in('id', studentIds)
    : { data: [] }

  const profileMap: Record<string, { name: string; email: string }> = {}
  for (const p of profiles ?? []) {
    profileMap[p.id] = { name: p.name, email: p.email }
  }

  // Existing attendance records
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

// POST: submit attendance for a lesson (school role)
export async function POST(
  request: Request,
  { params }: { params: Promise<{ lessonId: string }> }
) {
  const { lessonId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('school_id')
    .eq('id', user.id)
    .single()

  if (!profile?.school_id) return NextResponse.json({ error: 'School not found' }, { status: 404 })

  const schoolId = profile.school_id

  // Verify lesson belongs to this school
  const { data: lesson } = await supabase
    .from('lessons')
    .select('id, status, teacher_id, school_id')
    .eq('id', lessonId)
    .eq('school_id', schoolId)
    .single()

  if (!lesson) return NextResponse.json({ error: 'Lesson not found' }, { status: 404 })

  const body = await request.json()
  const records: { booking_id: string; student_id: string; status_id: string }[] = body.attendance

  if (!records || records.length === 0) {
    return NextResponse.json({ error: 'No attendance records provided' }, { status: 400 })
  }

  // Fetch status definitions to determine burns_credit
  const statusIds = [...new Set(records.map(r => r.status_id))]
  const { data: statusDefs } = await supabase
    .from('attendance_statuses')
    .select('id, name, burns_credit')
    .eq('school_id', schoolId)
    .in('id', statusIds)

  const statusMap: Record<string, { name: string; burns_credit: boolean }> = {}
  for (const s of statusDefs ?? []) {
    statusMap[s.id] = { name: s.name, burns_credit: s.burns_credit }
  }

  // Delete existing records (allows re-submission / editing)
  await supabase.from('attendance').delete().eq('lesson_id', lessonId)

  // Insert new attendance records
  const { error: insertErr } = await supabase.from('attendance').insert(
    records.map(r => ({
      lesson_id: lessonId,
      booking_id: r.booking_id,
      student_id: r.student_id,
      teacher_id: lesson.teacher_id,
      status_id: r.status_id,
      status: statusMap[r.status_id]?.burns_credit ? 'present' : 'no_show',
    }))
  )

  if (insertErr) {
    console.error('[school attendance POST] insert error', insertErr)
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  // Recalculate booking statuses
  const burnsIds = records.filter(r => statusMap[r.status_id]?.burns_credit).map(r => r.booking_id)
  const noburnsIds = records.filter(r => !statusMap[r.status_id]?.burns_credit).map(r => r.booking_id)

  if (burnsIds.length > 0) {
    await supabase.from('bookings').update({ status: 'attended' }).in('id', burnsIds)
  }
  if (noburnsIds.length > 0) {
    await supabase.from('bookings').update({ status: 'no_show' }).in('id', noburnsIds)
  }

  // Keep lesson as completed
  await supabase.from('lessons').update({ status: 'completed' }).eq('id', lessonId)

  return NextResponse.json({
    submitted: true,
    credit_burned: burnsIds.length,
    no_burn: noburnsIds.length,
  })
}
