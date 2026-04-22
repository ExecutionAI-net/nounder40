import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendLessonReminderEmail } from '@/lib/email-helpers'

export const maxDuration = 300

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = admin()

  // Target: lessons starting between 23h and 25h from now
  const now = new Date()
  const from = new Date(now.getTime() + 23 * 60 * 60 * 1000)
  const to = new Date(now.getTime() + 25 * 60 * 60 * 1000)

  const fromDate = from.toISOString().slice(0, 10)
  const toDate = to.toISOString().slice(0, 10)
  const fromTime = from.toISOString().slice(11, 19)
  const toTime = to.toISOString().slice(11, 19)

  // Fetch lessons in the window
  const { data: lessons, error } = await supabase
    .from('lessons')
    .select(`
      id, date, start_time,
      school_id,
      courses!course_id(name),
      teachers!teacher_id(name),
      school_rooms!room_id(name, school_locations!location_id(name)),
      schools!school_id(name)
    `)
    .eq('status', 'scheduled')
    .gte('date', fromDate)
    .lte('date', toDate)

  if (error) {
    console.error('[cron/reminder-1day] lessons fetch error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Filter by time within the window (cross-day edge case handled)
  const targetLessons = (lessons ?? []).filter(l => {
    const lessonDt = new Date(`${l.date}T${l.start_time}`)
    return lessonDt >= from && lessonDt <= to
  })

  let sent = 0

  for (const lesson of targetLessons) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lAny = lesson as unknown as Record<string, any>

    const { data: bookings } = await supabase
      .from('bookings')
      .select('student_id')
      .eq('lesson_id', lesson.id)
      .in('status', ['confirmed'])

    for (const booking of bookings ?? []) {
      await sendLessonReminderEmail(booking.student_id, 'student.lesson_reminder_1day', {
        school_name: lAny.schools?.name ?? '',
        lesson_name: lAny.courses?.name ?? '',
        lesson_date: new Date(lesson.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
        lesson_time: lesson.start_time?.slice(0, 5) ?? '',
        teacher_name: lAny.teachers?.name ?? '',
        location_name: lAny.school_rooms?.school_locations?.name ?? '',
      })
      sent++
    }
  }

  console.log(`[cron/reminder-1day] sent ${sent} reminders for ${targetLessons.length} lessons`)
  return NextResponse.json({ sent, lessons: targetLessons.length })
}
