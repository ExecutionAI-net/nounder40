import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

async function getSchoolId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
  return profile?.school_id ?? null
}

// POST: school manually adds a student to a class (books on behalf)
export async function POST(
  request: Request,
  { params }: { params: Promise<{ classId: string }> }
) {
  try {
    const { classId } = await params
    const supabase = await createClient()
    const schoolId = await getSchoolId(supabase)
    if (!schoolId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { student_id } = body
    if (!student_id) return NextResponse.json({ error: 'student_id required' }, { status: 400 })

    // Verify class belongs to this school
    const { data: lesson } = await supabase
      .from('lessons')
      .select('id, max_capacity, current_bookings, status, school_id, courses(credit_cost)')
      .eq('id', classId)
      .eq('school_id', schoolId)
      .single()

    if (!lesson) return NextResponse.json({ error: 'Class not found' }, { status: 404 })
    if (lesson.status === 'cancelled') return NextResponse.json({ error: 'Class is cancelled' }, { status: 400 })

    // Check not already booked
    const { data: existing } = await supabase
      .from('bookings')
      .select('id')
      .eq('lesson_id', classId)
      .eq('student_id', student_id)
      .in('status', ['confirmed', 'attended'])
      .maybeSingle()

    if (existing) return NextResponse.json({ error: 'Student already booked' }, { status: 400 })

    const creditCost = (lesson.courses as { credit_cost: number } | null)?.credit_cost ?? 1

    // Find valid subscription first, then package (same deduction priority as normal booking)
    let accessSource: 'subscription' | 'package' | 'free_lesson' = 'package'
    let studentPackageId: string | null = null
    let studentSubscriptionId: string | null = null
    let creditsDeducted = 0

    // Check active subscription
    const { data: sub } = await supabase
      .from('student_subscriptions')
      .select('id, access_remaining, access_total')
      .eq('student_id', student_id)
      .eq('school_id', schoolId)
      .eq('status', 'active')
      .maybeSingle()

    if (sub && (sub.access_total === null || (sub.access_remaining ?? 0) > 0)) {
      accessSource = 'subscription'
      studentSubscriptionId = sub.id
      // Deduct access
      if (sub.access_total !== null) {
        await supabase.from('student_subscriptions').update({
          access_remaining: (sub.access_remaining ?? 1) - 1
        }).eq('id', sub.id)
      }
    } else {
      // Check active package
      const { data: pkg } = await supabase
        .from('student_packages')
        .select('id, credits_remaining')
        .eq('student_id', student_id)
        .eq('school_id', schoolId)
        .eq('status', 'active')
        .gte('credits_remaining', creditCost)
        .order('expires_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (pkg) {
        accessSource = 'package'
        studentPackageId = pkg.id
        creditsDeducted = creditCost
        await supabase.from('student_packages').update({
          credits_remaining: pkg.credits_remaining - creditCost
        }).eq('id', pkg.id)
      } else {
        return NextResponse.json({ error: 'Student has no valid credits or subscription' }, { status: 400 })
      }
    }

    // Create booking
    const { data: booking, error: bookingErr } = await supabase
      .from('bookings')
      .insert({
        student_id,
        lesson_id: classId,
        school_id: schoolId,
        access_source: accessSource,
        student_package_id: studentPackageId,
        student_subscription_id: studentSubscriptionId,
        credits_deducted: creditsDeducted,
        status: 'confirmed',
        booked_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (bookingErr) {
      console.error('[class students POST]', bookingErr)
      return NextResponse.json({ error: bookingErr.message }, { status: 500 })
    }

    // Increment current_bookings on lesson
    await supabase.from('lessons').update({
      current_bookings: (lesson.current_bookings ?? 0) + 1
    }).eq('id', classId)

    return NextResponse.json({ booking })
  } catch (err) {
    console.error('[class students POST] unexpected', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// DELETE: school removes a student from a class (cancel + refund)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ classId: string }> }
) {
  try {
    const { classId } = await params
    const supabase = await createClient()
    const schoolId = await getSchoolId(supabase)
    if (!schoolId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const studentId = searchParams.get('student_id')
    if (!studentId) return NextResponse.json({ error: 'student_id required' }, { status: 400 })

    // Find the booking
    const { data: booking } = await supabase
      .from('bookings')
      .select('id, access_source, student_package_id, student_subscription_id, credits_deducted')
      .eq('lesson_id', classId)
      .eq('student_id', studentId)
      .eq('status', 'confirmed')
      .single()

    if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

    // Refund credits/access
    if (booking.access_source === 'package' && booking.student_package_id && booking.credits_deducted > 0) {
      const { data: pkg } = await supabase
        .from('student_packages')
        .select('credits_remaining')
        .eq('id', booking.student_package_id)
        .single()
      if (pkg) {
        await supabase.from('student_packages').update({
          credits_remaining: (pkg.credits_remaining ?? 0) + booking.credits_deducted
        }).eq('id', booking.student_package_id)
      }
    } else if (booking.access_source === 'subscription' && booking.student_subscription_id) {
      const { data: sub } = await supabase
        .from('student_subscriptions')
        .select('access_remaining, access_total')
        .eq('id', booking.student_subscription_id)
        .single()
      if (sub && sub.access_remaining !== null) {
        await supabase.from('student_subscriptions').update({
          access_remaining: (sub.access_remaining ?? 0) + 1
        }).eq('id', booking.student_subscription_id)
      }
    }

    // Cancel booking
    await supabase.from('bookings').update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancellation_type: 'within_policy',
      credit_refunded: true,
    }).eq('id', booking.id)

    // Decrement current_bookings
    const { data: lesson } = await supabase
      .from('lessons')
      .select('current_bookings')
      .eq('id', classId)
      .single()

    if (lesson) {
      await supabase.from('lessons').update({
        current_bookings: Math.max(0, (lesson.current_bookings ?? 1) - 1)
      }).eq('id', classId)
    }

    return NextResponse.json({ removed: true })
  } catch (err) {
    console.error('[class students DELETE] unexpected', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
