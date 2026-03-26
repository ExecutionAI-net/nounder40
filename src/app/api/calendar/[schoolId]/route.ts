import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ schoolId: string }> }
) {
  const { schoolId } = await params

  // Strip .ics extension if present
  const id = schoolId.replace(/\.ics$/, '')

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { searchParams } = new URL(request.url)
  const typeFilter = searchParams.get('type')
  const teacherFilter = searchParams.get('teacher')

  let query = admin
    .from('lessons')
    .select(`
      id, date, start_time, end_time, max_capacity, current_bookings,
      courses(name, color),
      lesson_types(code, name_en),
      teachers(name),
      school_rooms(name, school_locations(name, address))
    `)
    .eq('school_id', id)
    .eq('status', 'scheduled')
    .gte('date', new Date().toISOString().split('T')[0])
    .order('date', { ascending: true })

  if (teacherFilter) query = query.eq('teacher_id', teacherFilter)

  const { data: lessons, error } = await query

  if (error) {
    return new NextResponse('Error fetching lessons', { status: 500 })
  }

  const { data: school } = await admin.from('schools').select('name, city').eq('id', id).single()

  let filtered = lessons ?? []
  if (typeFilter) {
    filtered = filtered.filter((l) =>
      (l.lesson_types as unknown as { code: string } | null)?.code?.toLowerCase() === typeFilter.toLowerCase()
    )
  }

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//No Under 40//${school?.name ?? 'School'}//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${school?.name ?? 'School'} — No Under 40`,
    `X-WR-CALDESC:Lesson schedule for ${school?.name ?? 'School'}`,
    'X-WR-TIMEZONE:Europe/Rome',
  ]

  for (const lesson of filtered) {
    const lt = lesson.lesson_types as unknown as { code: string; name_en: string } | null
    const course = lesson.courses as unknown as { name: string } | null
    const teacher = lesson.teachers as unknown as { name: string } | null
    const room = lesson.school_rooms as unknown as { name: string; school_locations: { name: string; address: string } | null } | null

    const dtStart = formatDT(lesson.date, lesson.start_time)
    const dtEnd = formatDT(lesson.date, lesson.end_time)
    const uid = `lesson-${lesson.id}@nounder40`
    const summary = course?.name ?? lt?.name_en ?? 'Lesson'
    const location = room
      ? `${room.school_locations?.name ?? ''}, ${room.name}`.trim().replace(/^,\s*/, '')
      : school?.city ?? ''
    const description = [
      teacher ? `Teacher: ${teacher.name}` : '',
      `Spots: ${lesson.current_bookings}/${lesson.max_capacity}`,
      lesson.current_bookings >= lesson.max_capacity ? 'Status: FULL' : '',
    ].filter(Boolean).join('\\n')

    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${escape(summary)}`,
      `LOCATION:${escape(location)}`,
      `DESCRIPTION:${escape(description)}`,
      'END:VEVENT'
    )
  }

  lines.push('END:VCALENDAR')

  return new NextResponse(lines.join('\r\n'), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${id}.ics"`,
      'Cache-Control': 'no-cache, no-store',
    },
  })
}

function formatDT(date: string, time: string) {
  // Format: 20260101T090000
  const [y, m, d] = date.split('-')
  const [h, min] = time.split(':')
  return `${y}${m}${d}T${h}${min}00`
}

function escape(str: string) {
  return str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}
