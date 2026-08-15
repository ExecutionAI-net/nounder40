import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendLessonReminderEmail } from '@/lib/email-helpers'
import { formatLessonDate, parseLessonDateTime } from '@/lib/format-date'

export const dynamic = 'force-dynamic'

export const maxDuration = 300

// Runs once daily at 08:00 UTC (Vercel Hobby plan limitation).
// Sends 2-hour reminders for lessons starting between 10:00 and 10:30 UTC that day.
// Schools should schedule morning lessons with this in mind, or upgrade to Pro for hourly crons.

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = admin()

  // Cron fires at 08:00 UTC — target lessons starting 10:00–10:30 UTC same day
  const now = new Date()
  const from = new Date(now.getTime() + 2 * 60 * 60 * 1000)
  const to = new Date(now.getTime() + 2.5 * 60 * 60 * 1000)

  const targetDate = now.toISOString().slice(0, 10)

  const { data: lessons, error } = await supabase
    .from('lessons')
    .select(`
      id, date, start_time, is_online, online_link,
      school_id,
      courses!course_id(name),
      teachers!teacher_id(name),
      school_rooms!room_id(name, school_locations!location_id(name, address)),
      schools!school_id(name)
    `)
    .eq('status', 'scheduled')
    .eq('date', targetDate)

  if (error) {
    console.error('[cron/reminder-2hour] lessons fetch error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const targetLessons = (lessons ?? []).filter(l => {
    const lessonDt = parseLessonDateTime(l.date, l.start_time)
    return lessonDt >= from && lessonDt <= to
  })

  const lessonIds = targetLessons.map((l) => l.id)

  // Single batch query for all bookings — no N+1
  const { data: allBookings } = lessonIds.length
    ? await supabase
        .from('bookings')
        .select('lesson_id, student_id')
        .in('lesson_id', lessonIds)
        .eq('status', 'confirmed')
    : { data: [] }

  const bookingsByLesson: Record<string, string[]> = {}
  for (const b of allBookings ?? []) {
    if (!bookingsByLesson[b.lesson_id]) bookingsByLesson[b.lesson_id] = []
    bookingsByLesson[b.lesson_id].push(b.student_id)
  }

  // Fire all reminder emails in parallel
  const emailTasks: Promise<unknown>[] = []
  for (const lesson of targetLessons) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lAny = lesson as unknown as Record<string, any>
    const payload = {
      school_name: lAny.schools?.name ?? '',
      lesson_name: lAny.courses?.name ?? '',
      lesson_date: formatLessonDate(lesson.date),
      lesson_time: lesson.start_time?.slice(0, 5) ?? '',
      teacher_name: lAny.teachers?.name ?? '',
      location_name: lAny.is_online ? 'Online' : (lAny.school_rooms?.school_locations?.name ?? ''),
      location_address: lAny.is_online ? '' : (lAny.school_rooms?.school_locations?.address ?? ''),
      online_link: lAny.is_online && lAny.online_link
        ? (String(lAny.online_link).startsWith('http') ? lAny.online_link : `https://${lAny.online_link}`)
        : '',
    }
    for (const studentId of bookingsByLesson[lesson.id] ?? []) {
      emailTasks.push(sendLessonReminderEmail(studentId, 'student.lesson_reminder_2hour', payload))
    }
  }
  await Promise.allSettled(emailTasks)

  const sent = emailTasks.length
  console.log(`[cron/reminder-2hour] sent ${sent} reminders for ${targetLessons.length} lessons`)
  return NextResponse.json({ sent, lessons: targetLessons.length })
}
