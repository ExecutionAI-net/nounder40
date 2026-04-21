import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

function calcEndTime(startTime: string, durationMinutes: number): string {
  const [h, m] = startTime.split(':').map(Number)
  const total = h * 60 + m + durationMinutes
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function toDateStr(d: Date) {
  return d.toISOString().split('T')[0]
}

async function getSchoolId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
  return profile?.school_id ?? null
}

// POST: create one or more classes under an existing course
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const schoolId = await getSchoolId(supabase)
    if (!schoolId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const {
      course_id,
      date,
      start_time,
      duration_minutes,
      teacher_id,
      room_id,
      max_capacity,
      compensation_plan_id,
      notes,
      is_online,
      online_link,
      // recurring extras
      frequency,   // 'single' | 'weekly' | 'biweekly'
      end_date,
    } = body

    if (!course_id || !date || !start_time || !duration_minutes) {
      return NextResponse.json({ error: 'course_id, date, start_time, duration_minutes are required' }, { status: 400 })
    }

    // Verify course belongs to this school
    const { data: course } = await supabase
      .from('courses')
      .select('id, lesson_type_id, teacher_id, room_id, max_capacity, is_online, online_link')
      .eq('id', course_id)
      .eq('school_id', schoolId)
      .single()

    if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 })

    const endTime = calcEndTime(start_time, Number(duration_minutes))
    const lessonInserts: object[] = []

    if (!frequency || frequency === 'single') {
      lessonInserts.push({
        course_id,
        school_id: schoolId,
        lesson_type_id: course.lesson_type_id,
        teacher_id: teacher_id ?? course.teacher_id ?? null,
        room_id: room_id ?? course.room_id ?? null,
        compensation_plan_id: compensation_plan_id || null,
        notes: notes || null,
        is_online: is_online ?? course.is_online ?? false,
        online_link: online_link ?? course.online_link ?? null,
        date,
        start_time,
        end_time: endTime,
        max_capacity: Number(max_capacity ?? course.max_capacity ?? 15),
        status: 'scheduled',
      })
    } else {
      const intervalDays = frequency === 'biweekly' ? 14 : 7
      const startDt = new Date(date + 'T12:00:00')
      const endDt = end_date ? new Date(end_date + 'T12:00:00') : addDays(startDt, 365)
      let current = new Date(startDt)

      while (current <= endDt && lessonInserts.length < 200) {
        lessonInserts.push({
          course_id,
          school_id: schoolId,
          lesson_type_id: course.lesson_type_id,
          teacher_id: teacher_id ?? course.teacher_id ?? null,
          room_id: room_id ?? course.room_id ?? null,
          compensation_plan_id: compensation_plan_id || null,
          notes: notes || null,
          is_online: is_online ?? course.is_online ?? false,
          online_link: online_link ?? course.online_link ?? null,
          date: toDateStr(current),
          start_time,
          end_time: endTime,
          max_capacity: Number(max_capacity ?? course.max_capacity ?? 15),
          status: 'scheduled',
        })
        current = addDays(current, intervalDays)
      }
    }

    const { error: insertErr } = await supabase.from('lessons').insert(lessonInserts)
    if (insertErr) {
      console.error('[classes POST]', insertErr)
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    return NextResponse.json({ created: lessonInserts.length })
  } catch (err) {
    console.error('[classes POST] unexpected', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
