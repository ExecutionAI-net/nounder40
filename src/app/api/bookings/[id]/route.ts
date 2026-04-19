import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendBookingCancelledEmail } from '@/lib/email-helpers'
import { DEFAULT_CANCELLATION_HOURS } from '@/lib/constants'
import { formatLessonDate, parseLessonDateTime } from '@/lib/format-date'
import { revalidateAll } from '@/lib/revalidate'

// Cancel a booking
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: student } = await supabase
    .from('students')
    .select('id')
    .eq('user_id', user.id)
    .single()
  const studentId = student?.id ?? user.id

  // Get booking details
  const { data: booking, error: bookingErr } = await supabase
    .from('bookings')
    .select('id, student_id, lesson_id, school_id, status, access_source, student_package_id, student_subscription_id, credits_deducted')
    .eq('id', id)
    .eq('student_id', studentId)
    .single()

  if (bookingErr || !booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  if (booking.status !== 'confirmed') return NextResponse.json({ error: 'Booking cannot be cancelled' }, { status: 400 })

  // Get lesson date and school cancellation policy
  const { data: lesson } = await supabase
    .from('lessons')
    .select('date, start_time, current_bookings')
    .eq('id', booking.lesson_id)
    .single()

  const { data: school } = await supabase
    .from('schools')
    .select('cancellation_policy_hours')
    .eq('id', booking.school_id)
    .single()

  // Determine refund based on policy
  const policyHours = school?.cancellation_policy_hours ?? DEFAULT_CANCELLATION_HOURS
  const lessonStart = parseLessonDateTime(lesson!.date, lesson!.start_time)
  const hoursUntil = (lessonStart.getTime() - Date.now()) / (1000 * 60 * 60)
  const withinPolicy = hoursUntil >= policyHours
  const cancellationType = withinPolicy ? 'within_policy' : 'outside_policy'

  // Update booking status
  const { error: updateErr } = await supabase
    .from('bookings')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancellation_type: cancellationType,
      credit_refunded: withinPolicy,
    })
    .eq('id', id)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  // Restore lesson capacity. Uses the service-role client because migration 002
  // only grants UPDATE on lessons to school/hq roles — a student-session write
  // would silently affect 0 rows.
  const admin = createAdminClient()
  await admin
    .from('lessons')
    .update({ current_bookings: Math.max(0, (lesson!.current_bookings ?? 1) - 1) })
    .eq('id', booking.lesson_id)

  // Refund credit/access if within policy. Same RLS gotcha as the booking
  // POST: students cannot UPDATE student_packages or student_subscriptions
  // under their own session, so refunds must go through the admin client.
  if (withinPolicy && booking.credits_deducted > 0) {
    if (booking.access_source === 'package' && booking.student_package_id) {
      const { data: pkg } = await admin
        .from('student_packages')
        .select('credits_remaining')
        .eq('id', booking.student_package_id)
        .single()
      if (pkg) {
        await admin
          .from('student_packages')
          .update({ credits_remaining: pkg.credits_remaining + booking.credits_deducted, status: 'active' })
          .eq('id', booking.student_package_id)
      }
    } else if (booking.access_source === 'subscription' && booking.student_subscription_id) {
      const { data: sub } = await admin
        .from('student_subscriptions')
        .select('access_remaining')
        .eq('id', booking.student_subscription_id)
        .single()
      if (sub && sub.access_remaining !== null) {
        await admin
          .from('student_subscriptions')
          .update({ access_remaining: sub.access_remaining + 1 })
          .eq('id', booking.student_subscription_id)
      }
    }
  }

  await sendBookingCancelledEmail(user.id, {
    school_name: '',
    lesson_name: '',
    lesson_date: formatLessonDate(lesson?.date),
    lesson_time: lesson?.start_time?.slice(0, 5) ?? '',
    credit_refunded: withinPolicy,
    credits_deducted: booking.credits_deducted,
  })

  revalidateAll()
  return NextResponse.json({ cancelled: true, refunded: withinPolicy, policy_hours: policyHours })
}
