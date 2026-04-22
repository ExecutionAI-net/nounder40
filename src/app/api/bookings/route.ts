import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendBookingConfirmedEmail, sendSchoolNewBookingEmail, maybeSendCreditsLowEmail } from '@/lib/email-helpers'

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
    const lessonStart = new Date(`${lesson.date}T${lesson.start_time}`)
    const hoursUntil = (lessonStart.getTime() - Date.now()) / (1000 * 60 * 60)
    if (hoursUntil < minNoticeHours) {
      return NextResponse.json({ error: `Booking must be made at least ${minNoticeHours} hours in advance` }, { status: 400 })
    }
  }

  const schoolId = lesson.school_id

  console.log('[booking] user.id:', user.id, 'lesson school_id:', schoolId, 'creditCost:', creditCost)

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

  const totalCredits = (activePackages ?? []).reduce((sum, p) => sum + p.credits_remaining, 0)
  const hasCredits = totalCredits >= creditCost

  console.log('[booking] totalCredits:', totalCredits, 'creditCost:', creditCost, 'hasCredits:', hasCredits)

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

  // 9. Deduct credits/accesses and update lesson count
  await supabase
    .from('lessons')
    .update({ current_bookings: lesson.current_bookings + 1 })
    .eq('id', lesson_id)

  if (accessSource === 'package') {
    // Deduct creditCost from packages in order of earliest expiry
    let remaining = creditCost
    for (const pkg of (activePackages ?? [])) {
      if (remaining <= 0) break
      const deduct = Math.min(pkg.credits_remaining, remaining)
      const newRemaining = pkg.credits_remaining - deduct
      await supabase
        .from('student_packages')
        .update({
          credits_remaining: newRemaining,
          ...(newRemaining === 0 ? { status: 'exhausted' } : {}),
        })
        .eq('id', pkg.id)
      remaining -= deduct
    }
  } else if (accessSource === 'free_lesson' && schoolStudent) {
    await supabase
      .from('school_students')
      .update({ free_lesson_used: true })
      .eq('id', schoolStudent.id)
  }

  // Send emails (awaited so serverless doesn't terminate before completion)
  await Promise.allSettled([
    sendBookingConfirmedEmail(booking.id, user.id),
    sendSchoolNewBookingEmail(schoolId, {
      student_name: user.email ?? '',
      lesson_name: '',
      lesson_date: lesson.date,
      lesson_time: lesson.start_time,
    }),
    ...(accessSource === 'package'
      ? [maybeSendCreditsLowEmail(user.id, schoolId, totalCredits - creditCost)]
      : []),
  ])

  return NextResponse.json({ id: booking.id, access_source: accessSource })
}
