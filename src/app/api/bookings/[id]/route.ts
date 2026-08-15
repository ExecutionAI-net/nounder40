import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { sendBookingCancelledEmail } from '@/lib/email-helpers'
import { DEFAULT_CANCELLATION_HOURS } from '@/lib/constants'
import { formatLessonDate, parseLessonDateTime } from '@/lib/format-date'

export const dynamic = 'force-dynamic'

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = admin()
  const { data: student } = await db.from('students').select('id').eq('user_id', user.id).single()
  if (!student) return NextResponse.json({ error: 'Student record not found' }, { status: 404 })

  const { data: booking, error: bookingErr } = await db
    .from('bookings')
    .select('id, student_id, lesson_id, school_id, status, access_source, student_package_id, student_subscription_id, credits_deducted')
    .eq('id', id)
    .eq('student_id', student.id)
    .single()

  if (bookingErr || !booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  if (booking.status !== 'confirmed') return NextResponse.json({ error: 'Booking cannot be cancelled' }, { status: 400 })

  const { data: lesson } = await db
    .from('lessons')
    .select(`
      date, start_time, current_bookings, is_online,
      courses!course_id(name),
      lesson_types!lesson_type_id(name_en, name_it, name_es),
      schools!school_id(name)
    `)
    .eq('id', booking.lesson_id)
    .single()

  const { data: school } = await db
    .from('schools')
    .select('cancellation_policy_hours')
    .eq('id', booking.school_id)
    .single()

  const policyHours = school?.cancellation_policy_hours ?? DEFAULT_CANCELLATION_HOURS
  const lessonStart = parseLessonDateTime(lesson!.date, lesson!.start_time)
  const hoursUntil = (lessonStart.getTime() - Date.now()) / (1000 * 60 * 60)
  const withinPolicy = hoursUntil >= policyHours
  const cancellationType = withinPolicy ? 'within_policy' : 'outside_policy'

  const { error: updateErr } = await db
    .from('bookings')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancellation_type: cancellationType,
      credit_refunded: withinPolicy,
    })
    .eq('id', id)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  await db
    .from('lessons')
    .update({ current_bookings: Math.max(0, (lesson!.current_bookings ?? 1) - 1) })
    .eq('id', booking.lesson_id)

  if (withinPolicy && booking.credits_deducted > 0) {
    if (booking.access_source === 'package' && booking.student_package_id) {
      const { data: pkg } = await db
        .from('student_packages')
        .select('credits_remaining')
        .eq('id', booking.student_package_id)
        .single()
      if (pkg) {
        await db
          .from('student_packages')
          .update({ credits_remaining: pkg.credits_remaining + booking.credits_deducted, status: 'active' })
          .eq('id', booking.student_package_id)
      }
    } else if (booking.access_source === 'subscription' && booking.student_subscription_id) {
      const { data: sub } = await db
        .from('student_subscriptions')
        .select('access_remaining')
        .eq('id', booking.student_subscription_id)
        .single()
      if (sub && sub.access_remaining !== null) {
        await db
          .from('student_subscriptions')
          .update({ access_remaining: sub.access_remaining + 1 })
          .eq('id', booking.student_subscription_id)
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lAny = lesson as any
  await sendBookingCancelledEmail(user.id, {
    school_name: lAny?.schools?.name ?? '',
    lesson_name: '',
    course_name: lAny?.courses?.name ?? null,
    lesson_type_names: lAny?.lesson_types ?? null,
    lesson_date: formatLessonDate(lesson?.date),
    lesson_time: lesson?.start_time?.slice(0, 5) ?? '',
    credit_refunded: withinPolicy,
    credits_deducted: booking.credits_deducted,
    is_online: !!lesson?.is_online,
  })

  return NextResponse.json({ cancelled: true, refunded: withinPolicy, policy_hours: policyHours })
}
