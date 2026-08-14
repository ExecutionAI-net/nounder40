import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { BRAND_COLOR } from '@/lib/constants'

export const dynamic = 'force-dynamic'

function calcEndTime(startTime: string, durationMinutes: number): string {
  const [h, m] = startTime.split(':').map(Number)
  const total = h * 60 + m + durationMinutes
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

const JS_DAY_TO_WEEKDAY = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
const WEEKDAY_TO_JS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
}

// Move date to the nearest occurrence of targetWeekday on or after the given date
function shiftToWeekday(dateStr: string, targetWeekday: string): string {
  const target = WEEKDAY_TO_JS[targetWeekday]
  if (target === undefined) return dateStr
  const d = new Date(dateStr + 'T12:00:00')
  const current = d.getDay()
  const diff = (target - current + 7) % 7
  d.setDate(d.getDate() + diff)
  return d.toISOString().split('T')[0]
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
  if (!profile?.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: course, error } = await supabase
    .from('courses')
    .select('*')
    .eq('id', id)
    .eq('school_id', profile.school_id)
    .single()

  if (error || !course) return NextResponse.json({ error: 'Course not found' }, { status: 404 })

  // Linked-record counts (shown before deleting)
  const admin = createAdminClient()
  const [{ count: lessons }, { count: bookings }] = await Promise.all([
    admin.from('lessons').select('id', { count: 'exact', head: true }).eq('course_id', id).neq('status', 'cancelled'),
    admin.from('bookings').select('id', { count: 'exact', head: true }).in('status', ['confirmed'])
      .in('lesson_id', (await admin.from('lessons').select('id').eq('course_id', id)).data?.map(l => l.id) ?? []),
  ])

  return NextResponse.json({ ...course, _linked: { lessons: lessons ?? 0, bookings: bookings ?? 0 } })
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
  if (!profile?.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const schoolId = profile.school_id
  const body = await request.json()

  const {
    lesson_type_id, teacher_id, room_id, name, description, notes,
    is_online, online_link,
    country, city,
    start_time, duration_minutes, max_capacity, reserve_spots,
    credit_cost, color, vip_booking_hours_before, min_booking_notice_hours,
    waitlist_enabled,
    update_future_lessons,
    schedules, // per-weekday schedule overrides
  } = body

  // name is an optional custom label — the display name derives from the lesson type
  if (!lesson_type_id) {
    return NextResponse.json({ error: 'missing_fields', fields: ['lesson_type_id'] }, { status: 400 })
  }

  // Update course
  const { data: course, error: courseErr } = await supabase
    .from('courses')
    .update({
      lesson_type_id,
      teacher_id: teacher_id || null,
      room_id: room_id || null,
      name: name || null,
      description: description || null,
      notes: notes || null,
      is_online: is_online || false,
      online_link: online_link || null,
      country: country || null,
      city: city || null,
      start_time,
      duration_minutes: Number(duration_minutes),
      max_capacity: Number(max_capacity) || 15,
      reserve_spots: Number(reserve_spots) || 0,
      credit_cost: Number(credit_cost) || 1,
      color: color || BRAND_COLOR,
      vip_booking_hours_before: Number(vip_booking_hours_before) || 0,
      min_booking_notice_hours: Number(min_booking_notice_hours) || 2,
      waitlist_enabled: waitlist_enabled || false,
    })
    .eq('id', id)
    .eq('school_id', schoolId)
    .select()
    .single()

  if (courseErr || !course) {
    console.error('[courses PUT] course update error:', courseErr?.message)
    return NextResponse.json({ error: courseErr?.message ?? 'Update failed' }, { status: 500 })
  }

  type ScheduleOverride = {
    weekday?: string | null
    original_weekday?: string | null
    start_time?: string
    duration_minutes?: number
    max_capacity?: number
    credit_cost?: number
    color?: string
    vip_booking_hours_before?: number
    min_booking_notice_hours?: number
    room_id?: string | null
    teacher_id?: string | null
    reserve_spots?: number
    waitlist_enabled?: boolean
    end_date?: string | null
    start_date?: string | null
    is_new?: boolean
  }

  const scheduleList: ScheduleOverride[] = schedules ?? []
  // gli orari nuovi non devono mai abbinarsi alle lezioni esistenti
  const matchList = scheduleList.filter(s => !s.is_new)
  const today = new Date().toISOString().split('T')[0]

  const lessonFields = (sched: ScheduleOverride, date: string, st: string, endTime: string) => ({
    course_id: id, school_id: schoolId,
    teacher_id: (sched.teacher_id !== undefined ? sched.teacher_id : teacher_id) || null,
    room_id: (sched.room_id !== undefined ? sched.room_id : room_id) || null,
    lesson_type_id,
    date, start_time: st, end_time: endTime,
    max_capacity: sched.max_capacity ?? Number(max_capacity) ?? 15,
    is_online: is_online || false,
    online_link: online_link || null,
    status: 'scheduled',
  })

  // Optionally update the existing future lessons (fields, weekday shift)
  if (update_future_lessons) {
    const { data: futureLessons } = await supabase
      .from('lessons')
      .select('id, date, start_time')
      .eq('course_id', id)
      .eq('school_id', schoolId)
      .gte('date', today)
      .neq('status', 'cancelled')

    for (const lesson of futureLessons ?? []) {
      const jsDay = new Date(lesson.date + 'T12:00:00').getDay()
      const lessonWeekday = JS_DAY_TO_WEEKDAY[jsDay]

      const sched: ScheduleOverride = matchList.find((s: ScheduleOverride) =>
        (s.original_weekday && s.original_weekday === lessonWeekday) ||
        (!s.original_weekday && s.weekday === lessonWeekday)
      ) ?? matchList[0] ?? {}

      const st = sched.start_time ?? start_time
      const dur = sched.duration_minutes ?? Number(duration_minutes)
      const endTime = st ? calcEndTime(st, dur) : undefined

      const updateData: Record<string, unknown> = {
        lesson_type_id,
        max_capacity: sched.max_capacity ?? Number(max_capacity) ?? 15,
        teacher_id: sched.teacher_id !== undefined ? (sched.teacher_id || null) : (teacher_id || null),
        room_id: sched.room_id !== undefined ? (sched.room_id || null) : (room_id || null),
        is_online: is_online || false,
        online_link: online_link || null,
      }
      if (st) { updateData.start_time = st; updateData.end_time = endTime }

      if (sched.weekday && sched.weekday !== lessonWeekday) {
        updateData.date = shiftToWeekday(lesson.date, sched.weekday)
      }

      await supabase.from('lessons').update(updateData).eq('id', lesson.id)
    }
  }

  // Window management — ALWAYS runs (new schedules and start/end date changes
  // must persist even when the user chooses "update template only")
  const { data: freshLessons } = await supabase
    .from('lessons')
    .select('id, date, start_time, status')
    .eq('course_id', id)
    .eq('school_id', schoolId)
    .gte('date', today)
    .neq('status', 'cancelled')

  for (const sched of scheduleList) {
    const st = sched.start_time ?? start_time
    if (!st) continue
    const dur = sched.duration_minutes ?? Number(duration_minutes) ?? 60
    const endTime = calcEndTime(st, dur)

    if (sched.is_new) {
      // Nuovo orario inline: genera le lezioni della sua finestra
      if (!sched.start_date) continue
      const endDate = sched.end_date ?? sched.start_date
      const firstDate = sched.weekday ? shiftToWeekday(sched.start_date, sched.weekday) : sched.start_date
      const inserts: object[] = []
      const cursor = new Date(firstDate + 'T12:00:00')
      while (cursor.toISOString().split('T')[0] <= endDate && inserts.length < 200) {
        inserts.push(lessonFields(sched, cursor.toISOString().split('T')[0], st, endTime))
        cursor.setDate(cursor.getDate() + 7)
      }
      if (inserts.length) {
        const { error: insErr } = await supabase.from('lessons').insert(inserts)
        if (insErr) console.error('[courses PUT] new schedule error:', insErr.message)
      }
      continue
    }

    // Orario esistente: la finestra [data inizio → data fine] è editabile.
    // Le lezioni fuori finestra vengono annullate, quelle mancanti generate.
    if (!sched.start_date && !sched.end_date) continue
    const weekday = sched.weekday ?? sched.original_weekday
    if (!weekday) continue

    const schedLessons = (freshLessons ?? [])
      .filter(l => JS_DAY_TO_WEEKDAY[new Date(l.date + 'T12:00:00').getDay()] === weekday
        && l.start_time?.slice(0, 5) === st.slice(0, 5))
      .sort((a, b) => a.date.localeCompare(b.date))
    if (!schedLessons.length && !sched.start_date) continue

    const windowStartRaw = sched.start_date ?? schedLessons[0]?.date
    const windowEnd = sched.end_date ?? schedLessons[schedLessons.length - 1]?.date
    if (!windowStartRaw || !windowEnd) continue
    const windowStart = shiftToWeekday(windowStartRaw < today ? today : windowStartRaw, weekday)

    // desired weekly dates within the window
    const desired = new Set<string>()
    const cursor = new Date(windowStart + 'T12:00:00')
    while (cursor.toISOString().split('T')[0] <= windowEnd && desired.size < 200) {
      desired.add(cursor.toISOString().split('T')[0])
      cursor.setDate(cursor.getDate() + 7)
    }

    const existingDates = new Set(schedLessons.map(l => l.date))
    // cancel out-of-window lessons
    for (const l of schedLessons) {
      if (!desired.has(l.date)) {
        await supabase.from('lessons').update({ status: 'cancelled' }).eq('id', l.id)
      }
    }
    // insert missing in-window dates
    const inserts: object[] = []
    for (const d of desired) {
      if (!existingDates.has(d)) inserts.push(lessonFields(sched, d, st, endTime))
    }
    if (inserts.length) {
      const { error: insErr } = await supabase.from('lessons').insert(inserts)
      if (insErr) console.error('[courses PUT] window error:', insErr.message)
    }
  }

  return NextResponse.json({ id: course.id })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
    if (!profile?.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const today = new Date().toISOString().split('T')[0]

    // Cancel future lessons (not past, not already cancelled)
    const { data: futureLessons } = await supabase
      .from('lessons')
      .select('id')
      .eq('course_id', id)
      .eq('school_id', profile.school_id)
      .gte('date', today)
      .neq('status', 'cancelled')

    for (const lesson of futureLessons ?? []) {
      // Refund all confirmed bookings
      const { data: bookings } = await supabase
        .from('bookings')
        .select('id, access_source, student_package_id, student_subscription_id, credits_deducted')
        .eq('lesson_id', lesson.id)
        .eq('status', 'confirmed')

      for (const booking of bookings ?? []) {
        if (booking.access_source === 'package' && booking.student_package_id && booking.credits_deducted > 0) {
          const { data: pkg } = await supabase.from('student_packages').select('credits_remaining').eq('id', booking.student_package_id).single()
          if (pkg) {
            await supabase.from('student_packages').update({ credits_remaining: (pkg.credits_remaining ?? 0) + booking.credits_deducted }).eq('id', booking.student_package_id)
          }
        } else if (booking.access_source === 'subscription' && booking.student_subscription_id) {
          const { data: sub } = await supabase.from('student_subscriptions').select('access_remaining, access_total').eq('id', booking.student_subscription_id).single()
          if (sub && sub.access_remaining !== null) {
            await supabase.from('student_subscriptions').update({ access_remaining: (sub.access_remaining ?? 0) + 1 }).eq('id', booking.student_subscription_id)
          }
        }
        await supabase.from('bookings').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancellation_type: 'within_policy', credit_refunded: true }).eq('id', booking.id)
      }

      await supabase.from('lessons').update({ status: 'cancelled' }).eq('id', lesson.id)
    }

    // Delete the course itself
    await supabase.from('courses').delete().eq('id', id).eq('school_id', profile.school_id)

    console.log(`[courses DELETE] course ${id}: ${futureLessons?.length ?? 0} future classes cancelled, course deleted`)
    return NextResponse.json({ deleted: true, classes_cancelled: futureLessons?.length ?? 0 })
  } catch (err) {
    console.error('[courses DELETE] unexpected', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
