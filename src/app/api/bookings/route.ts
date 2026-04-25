import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendBookingConfirmedEmail, sendSchoolNewBookingEmail, maybeSendCreditsLowEmail } from '@/lib/email-helpers'
import { formatLessonDate, parseLessonDateTime } from '@/lib/format-date'
import { revalidateAll } from '@/lib/revalidate'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status') // upcoming, past, cancelled

  let query = supabase
    .from('bookings')
    .select(`
      id, status, booked_at, cancelled_at, credit_refunded, credits_deducted, access_source,
      lessons!lesson_id(
        id, date, start_time, end_time, school_id, is_online, online_link,
        courses!course_id(name, color),
        lesson_types!lesson_type_id(name_en),
        teachers!teacher_id(name),
        school_rooms!room_id(name, school_locations!location_id(name))
      ),
      schools!school_id(name, city, cancellation_policy_hours)
    `)
    .eq('student_id', user.id)
    .order('booked_at', { ascending: false })

  if (status === 'upcoming') {
    query = query.eq('status', 'confirmed')
  } else if (status === 'past') {
    query = query.in('status', ['attended', 'no_show'])
  } else if (status === 'cancelled') {
    query = query.eq('status', 'cancelled')
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  revalidateAll()
  return NextResponse.json(data ?? [])
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { lesson_id } = body

  if (!lesson_id) return NextResponse.json({ error: 'lesson_id required' }, { status: 400 })

  // 1. Get lesson details
  const { data: lesson, error: lessonErr } = await supabase
    .from('lessons')
    .select('id, school_id, date, start_time, max_capacity, current_bookings, status, courses(credit_cost, min_booking_notice_hours)')
    .eq('id', lesson_id)
    .single()

  if (lessonErr || !lesson) return NextResponse.json({ error: 'Lesson not found' }, { status: 404 })
  if (lesson.status !== 'scheduled') return NextResponse.json({ error: 'Lesson is not available' }, { status: 400 })

  // 2. Capacity check
  if (lesson.current_bookings >= lesson.max_capacity) {
    revalidateAll()
    return NextResponse.json({ error: 'Lesson is full' }, { status: 400 })
  }

  // 3. Duplicate booking check
  const { data: existingBooking } = await supabase
    .from('bookings')
    .select('id')
    .eq('student_id', user.id)
    .eq('lesson_id', lesson_id)
    .neq('status', 'cancelled')
    .maybeSingle()

  if (existingBooking) return NextResponse.json({ error: 'Already booked' }, { status: 400 })

  // 4. Min booking notice check
  const course = lesson.courses as unknown as { credit_cost: number; min_booking_notice_hours: number } | null
  const creditCost = course?.credit_cost ?? 1
  const minNoticeHours = course?.min_booking_notice_hours ?? 0

  if (minNoticeHours > 0) {
    const lessonStart = parseLessonDateTime(lesson.date, lesson.start_time)
    const hoursUntil = (lessonStart.getTime() - Date.now()) / (1000 * 60 * 60)
    if (hoursUntil < minNoticeHours) {
      revalidateAll()
      return NextResponse.json({ error: `Booking must be made at least ${minNoticeHours} hours in advance` }, { status: 400 })
    }
  }

  const schoolId = lesson.school_id

  console.log('[booking] lesson:', lesson_id, 'school:', schoolId, 'creditCost:', creditCost)

  // 5. Check total credits across all active packages for this school
  const { data: activePackages } = await supabase
    .from('student_packages')
    .select('id, credits_remaining')
    .eq('student_id', user.id)
    .eq('school_id', schoolId)
    .eq('status', 'active')
    .gte('expires_at', new Date().toISOString())
    .gt('credits_remaining', 0)
    .order('expires_at', { ascending: true })
    .limit(20)

  const totalCredits = (activePackages ?? []).reduce((sum, p) => sum + p.credits_remaining, 0)
  const hasCredits = totalCredits >= creditCost


  // 6. Check free first lesson
  const { data: schoolStudent } = await supabase
    .from('school_students')
    .select('id, free_lesson_used')
    .eq('student_id', user.id)
    .eq('school_id', schoolId)
    .maybeSingle()

  let accessSource: string
  let studentPackageId: string | null = null
  let creditsDeducted = creditCost

  // Determine access source: free lesson > credits
  if (schoolStudent && !schoolStudent.free_lesson_used) {
    accessSource = 'free_lesson'
    creditsDeducted = 0
  } else if (hasCredits) {
    accessSource = 'package'
    studentPackageId = (activePackages ?? [])[0]?.id ?? null
  } else {
    revalidateAll()
    return NextResponse.json({ error: 'You do not have enough credits to book this lesson. Please purchase a package from this school.' }, { status: 400 })
  }

  // 8. Create booking
  const { data: booking, error: bookingErr } = await supabase
    .from('bookings')
    .insert({
      student_id: user.id,
      lesson_id,
      school_id: schoolId,
      access_source: accessSource,
      student_package_id: studentPackageId,
      credits_deducted: creditsDeducted,
      status: 'confirmed',
    })
    .select()
    .single()

  if (bookingErr) return NextResponse.json({ error: bookingErr.message }, { status: 500 })

  // 9. Deduct credits and update lesson count — run all writes in parallel.
  // The lessons.current_bookings update needs the service-role client: RLS
  // (migration 002) only grants UPDATE on lessons to school/hq roles, so a
  // student-session update would silently affect 0 rows and the capacity
  // counter would never increment.
  // The .lt() guard on current_bookings acts as an optimistic concurrency check;
  // a truly atomic solution requires a Supabase RPC (book_lesson stored procedure).
  const admin = createAdminClient()
  const writes: Promise<unknown>[] = [
    admin
      .from('lessons')
      .update({ current_bookings: lesson.current_bookings + 1 })
      .eq('id', lesson_id)
      .lt('current_bookings', lesson.max_capacity),
  ]

  // Both student_packages.credits_remaining and school_students.free_lesson_used
  // need the service-role client. RLS only allows the school role to UPDATE
  // these tables; a student-session write silently affects 0 rows so the
  // credits never get deducted (same gotcha as the lessons table above).
  if (accessSource === 'package') {
    let remaining = creditCost
    for (const pkg of (activePackages ?? [])) {
      if (remaining <= 0) break
      const deduct = Math.min(pkg.credits_remaining, remaining)
      const newRemaining = pkg.credits_remaining - deduct
      writes.push(
        admin
          .from('student_packages')
          .update({
            credits_remaining: newRemaining,
            ...(newRemaining === 0 ? { status: 'exhausted' } : {}),
          })
          .eq('id', pkg.id)
      )
      remaining -= deduct
    }
  } else if (accessSource === 'free_lesson' && schoolStudent) {
    writes.push(
      admin
        .from('school_students')
        .update({ free_lesson_used: true })
        .eq('id', schoolStudent.id)
    )
  }

  await Promise.all(writes)

  // Fetch full lesson details for school email
  const { data: lessonFull } = await supabase
    .from('lessons')
    .select(`
      date, start_time,
      courses!course_id(name),
      teachers!teacher_id(name),
      school_rooms!room_id(name, school_locations!location_id(name))
    `)
    .eq('id', lesson_id)
    .single()

  const { data: studentProfile } = await supabase
    .from('profiles')
    .select('name, email')
    .eq('id', user.id)
    .maybeSingle()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lf = lessonFull as any

  await Promise.allSettled([
    sendBookingConfirmedEmail(booking.id, user.id),
    sendSchoolNewBookingEmail(schoolId, {
      student_name: studentProfile?.name || studentProfile?.email || user.email || '',
      lesson_name: lf?.courses?.name ?? '',
      lesson_date: formatLessonDate(lesson.date),
      lesson_time: lesson.start_time?.slice(0, 5) ?? '',
      teacher_name: lf?.teachers?.name ?? '',
      location_name: lf?.school_rooms?.school_locations?.name ?? '',
    }),
    ...(accessSource === 'package'
      ? [maybeSendCreditsLowEmail(user.id, schoolId, totalCredits - creditCost)]
      : []),
  ])

  revalidateAll()
  return NextResponse.json({ id: booking.id, access_source: accessSource })
}
