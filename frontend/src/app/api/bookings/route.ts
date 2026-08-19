import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getShowTeacherMap } from '@/lib/school-visibility'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { sendBookingConfirmedEmail, sendSchoolNewBookingEmail, maybeSendCreditsLowEmail } from '@/lib/email-helpers'
import { formatLessonDate, parseLessonDateTime } from '@/lib/format-date'

export const dynamic = 'force-dynamic'

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

type Db = ReturnType<typeof admin>

/**
 * Documenti obbligatori mancanti o scaduti per questa scuola.
 * null = la scuola ha scelto di non bloccare le prenotazioni.
 */
async function findMissingDocuments(db: Db, studentId: string, schoolId: string): Promise<string[] | null> {
  const { data: school } = await db
    .from('schools')
    .select('block_booking_on_documents')
    .eq('id', schoolId)
    .maybeSingle()

  if (!school?.block_booking_on_documents) return null

  const { data: required } = await db
    .from('school_document_types')
    .select('id, name')
    .eq('school_id', schoolId)
    .eq('active', true)
    .eq('required', true)

  if (!required?.length) return []

  const { data: docs } = await db
    .from('student_documents')
    .select('type_id, expires_at, status')
    .eq('student_id', studentId)
    .eq('school_id', schoolId)

  const now = Date.now()
  const valid = new Set(
    (docs ?? [])
      .filter(d => d.status !== 'expired' && (!d.expires_at || new Date(d.expires_at).getTime() > now))
      .map(d => d.type_id)
  )

  return required.filter(t => !valid.has(t.id)).map(t => t.name)
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = admin()
  const { data: student } = await db.from('students').select('id').eq('user_id', user.id).single()
  if (!student) return NextResponse.json([])

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')

  let query = db
    .from('bookings')
    .select(`
      id, status, booked_at, cancelled_at, credit_refunded, credits_deducted, access_source,
      lessons!lesson_id(
        id, date, start_time, end_time, school_id, is_online, online_link,
        courses!course_id(name, color),
        lesson_types!lesson_type_id(name_en, name_it, name_es),
        teachers!teacher_id(name),
        school_rooms!room_id(name, school_locations!location_id(name, address, google_maps_url))
      ),
      schools!school_id(name, city, cancellation_policy_hours)
    `)
    .eq('student_id', student.id)
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

  // Insegnante oscurato per le scuole che lo nascondono alle allieve
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rowsAny = (data ?? []) as any[]
  const showTeacher = await getShowTeacherMap(rowsAny.map(b => b.lessons?.school_id))
  for (const b of rowsAny) {
    if (b.lessons && showTeacher[b.lessons.school_id] === false) b.lessons.teachers = null
  }
  return NextResponse.json(rowsAny)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = admin()
  const { data: student } = await db.from('students').select('id').eq('user_id', user.id).single()
  if (!student) return NextResponse.json({ error: 'Student record not found' }, { status: 404 })

  const body = await request.json()
  const { lesson_id } = body

  if (!lesson_id) return NextResponse.json({ error: 'lesson_id required' }, { status: 400 })

  // 1. Get lesson details
  const { data: lesson, error: lessonErr } = await db
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
  const { data: existingBooking } = await db
    .from('bookings')
    .select('id')
    .eq('student_id', student.id)
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
      return NextResponse.json({ error: `Booking must be made at least ${minNoticeHours} hours in advance` }, { status: 400 })
    }
  }

  const schoolId = lesson.school_id

  console.log('[booking] lesson:', lesson_id, 'school:', schoolId, 'student:', student.id, 'creditCost:', creditCost)

  // 4b. Documenti obbligatori: la scuola sceglie se bloccare o solo avvisare
  // (Impostazioni → Documenti). Manca o scaduto = niente prenotazione.
  const missingDocuments = await findMissingDocuments(db, student.id, schoolId)
  if (missingDocuments === null) {
    // blocco disattivato: si prosegue
  } else if (missingDocuments.length > 0) {
    return NextResponse.json(
      { error: 'documents_required', documents: missingDocuments },
      { status: 400 }
    )
  }

  // 5. Check total credits across all active packages for this school
  const { data: activePackages } = await db
    .from('student_packages')
    .select('id, credits_remaining')
    .eq('student_id', student.id)
    .eq('school_id', schoolId)
    .eq('status', 'active')
    .gte('expires_at', new Date().toISOString())
    .gt('credits_remaining', 0)
    .order('expires_at', { ascending: true })
    .limit(20)

  const totalCredits = (activePackages ?? []).reduce((sum, p) => sum + p.credits_remaining, 0)
  const hasCredits = totalCredits >= creditCost

  let accessSource: string
  let studentPackageId: string | null = null
  const creditsDeducted = creditCost

  if (hasCredits) {
    accessSource = 'package'
    studentPackageId = (activePackages ?? [])[0]?.id ?? null
  } else {
    return NextResponse.json({ error: 'You do not have enough credits to book this lesson. Please purchase a package from this school.' }, { status: 400 })
  }

  // 7. Create booking
  const { data: booking, error: bookingErr } = await db
    .from('bookings')
    .insert({
      student_id: student.id,
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

  // 8. Deduct credits and update lesson count
  const writes: Promise<unknown>[] = [
    db
      .from('lessons')
      .update({ current_bookings: lesson.current_bookings + 1 })
      .eq('id', lesson_id)
      .lt('current_bookings', lesson.max_capacity),
  ]

  if (accessSource === 'package') {
    let remaining = creditCost
    for (const pkg of (activePackages ?? [])) {
      if (remaining <= 0) break
      const deduct = Math.min(pkg.credits_remaining, remaining)
      const newRemaining = pkg.credits_remaining - deduct
      writes.push(
        db
          .from('student_packages')
          .update({
            credits_remaining: newRemaining,
            ...(newRemaining === 0 ? { status: 'exhausted' } : {}),
          })
          .eq('id', pkg.id)
      )
      remaining -= deduct
    }
  }

  await Promise.all(writes)

  // Fetch full lesson details for school email
  const { data: lessonFull } = await db
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

  return NextResponse.json({ id: booking.id, access_source: accessSource })
}
