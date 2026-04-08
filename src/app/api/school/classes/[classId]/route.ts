import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

function calcEndTime(startTime: string, durationMinutes: number): string {
  const [h, m] = startTime.split(':').map(Number)
  const total = h * 60 + m + durationMinutes
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

async function getSchoolId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
  return profile?.school_id ?? null
}

// GET: single class detail + enrolled students
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ classId: string }> }
) {
  try {
    const { classId } = await params
    const supabase = await createClient()
    const schoolId = await getSchoolId(supabase)
    if (!schoolId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: lesson, error } = await supabase
      .from('lessons')
      .select(`
        id, date, start_time, end_time, max_capacity, current_bookings, status,
        course_id,
        courses(id, name, color, credit_cost),
        lesson_types(id, name_en, name_it),
        teachers(id, name),
        school_rooms(id, name, school_locations(id, name))
      `)
      .eq('id', classId)
      .eq('school_id', schoolId)
      .single()

    if (error || !lesson) return NextResponse.json({ error: 'Class not found' }, { status: 404 })

    // Get enrolled students
    const { data: bookings } = await supabase
      .from('bookings')
      .select('id, student_id, access_source, status, booked_at')
      .eq('lesson_id', classId)
      .in('status', ['confirmed', 'attended', 'no_show'])

    const studentIds = (bookings ?? []).map(b => b.student_id)
    const { data: profiles } = studentIds.length > 0
      ? await supabase.from('profiles').select('id, name, email').in('id', studentIds)
      : { data: [] }

    const profileMap: Record<string, { name: string; email: string }> = {}
    for (const p of profiles ?? []) profileMap[p.id] = p

    return NextResponse.json({
      ...lesson,
      enrollments: (bookings ?? []).map(b => ({
        ...b,
        student: profileMap[b.student_id] ?? null,
      })),
    })
  } catch (err) {
    console.error('[classes GET]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// PATCH: edit any field of a single class
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ classId: string }> }
) {
  try {
    const { classId } = await params
    const supabase = await createClient()
    const schoolId = await getSchoolId(supabase)
    if (!schoolId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const {
      teacher_id, room_id, date, start_time, duration_minutes,
      max_capacity, credit_cost, status,
    } = body

    const updateData: Record<string, unknown> = {}
    if (teacher_id !== undefined) updateData.teacher_id = teacher_id || null
    if (room_id !== undefined) updateData.room_id = room_id || null
    if (date !== undefined) updateData.date = date
    if (start_time !== undefined) updateData.start_time = start_time
    if (max_capacity !== undefined) updateData.max_capacity = Number(max_capacity)
    if (credit_cost !== undefined) updateData.credit_cost = Number(credit_cost)
    if (status !== undefined) updateData.status = status

    // Recalculate end_time if start_time or duration changed
    if (start_time !== undefined && duration_minutes !== undefined) {
      updateData.end_time = calcEndTime(start_time, Number(duration_minutes))
    }

    const { data, error } = await supabase
      .from('lessons')
      .update(updateData)
      .eq('id', classId)
      .eq('school_id', schoolId)
      .select()
      .single()

    if (error) {
      console.error('[classes PATCH]', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ class: data })
  } catch (err) {
    console.error('[classes PATCH] unexpected', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// DELETE: cancel a class — refund all bookings
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ classId: string }> }
) {
  try {
    const { classId } = await params
    const supabase = await createClient()
    const schoolId = await getSchoolId(supabase)
    if (!schoolId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Get all confirmed bookings
    const { data: bookings } = await supabase
      .from('bookings')
      .select('id, access_source, student_package_id, student_subscription_id, credits_deducted')
      .eq('lesson_id', classId)
      .eq('status', 'confirmed')

    // Refund credits/accesses for each booking
    for (const booking of bookings ?? []) {
      if (booking.access_source === 'package' && booking.student_package_id && booking.credits_deducted > 0) {
        await supabase.rpc('increment_credits', {
          p_package_id: booking.student_package_id,
          p_amount: booking.credits_deducted,
        }).catch(() => {
          // fallback manual update
          supabase.from('student_packages')
            .select('credits_remaining')
            .eq('id', booking.student_package_id)
            .single()
            .then(({ data }) => {
              if (data) {
                supabase.from('student_packages').update({
                  credits_remaining: (data.credits_remaining ?? 0) + booking.credits_deducted
                }).eq('id', booking.student_package_id)
              }
            })
        })
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
    }

    // Cancel all bookings
    const bookingIds = (bookings ?? []).map(b => b.id)
    if (bookingIds.length > 0) {
      await supabase.from('bookings').update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancellation_type: 'within_policy',
        credit_refunded: true,
      }).in('id', bookingIds)
    }

    // Mark lesson as cancelled
    const { error } = await supabase
      .from('lessons')
      .update({ status: 'cancelled' })
      .eq('id', classId)
      .eq('school_id', schoolId)

    if (error) {
      console.error('[classes DELETE]', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    console.log(`[classes DELETE] lesson ${classId} cancelled, ${bookingIds.length} bookings refunded`)
    return NextResponse.json({ cancelled: true, refunded: bookingIds.length })
  } catch (err) {
    console.error('[classes DELETE] unexpected', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
