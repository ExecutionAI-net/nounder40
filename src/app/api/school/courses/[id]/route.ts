import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { BRAND_COLOR } from '@/lib/constants'
import { fetchAllRows } from '@/lib/fetch-all-rows'

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
    original_start_time?: string | null
    start_time?: string
    duration_minutes?: number
    max_capacity?: number
    credit_cost?: number
    color?: string
    compensation_plan_id?: string | null
    is_online?: boolean
    online_link?: string | null
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
    color: sched.color ?? color ?? BRAND_COLOR,
    compensation_plan_id: sched.compensation_plan_id ?? null,
    is_online: sched.is_online ?? is_online ?? false,
    online_link: (sched.online_link !== undefined ? sched.online_link : online_link) || null,
    status: 'scheduled',
  })

  // Insert tollerante: se lessons.color non esiste ancora (migrazione 053
  // non applicata) riprova senza il campo, invece di perdere le lezioni.
  const insertLessons = async (rows: Record<string, unknown>[], label: string) => {
    if (!rows.length) return
    let { error: insErr } = await supabase.from('lessons').insert(rows)
    if (insErr && insErr.message.includes('color')) {
      ;({ error: insErr } = await supabase.from('lessons').insert(
        rows.map(r => { const { color: _c, ...rest } = r; return rest })
      ))
    }
    if (insErr) console.error(`[courses PUT] ${label} error:`, insErr.message)
  }

  const loadFutureLessons = () => fetchAllRows<{ id: string; date: string; start_time: string | null }>(
    (from, to) => supabase
      .from('lessons')
      .select('id, date, start_time')
      .eq('course_id', id)
      .eq('school_id', schoolId)
      .gte('date', today)
      .neq('status', 'cancelled')
      .order('date', { ascending: true })
      .range(from, to)
  )

  // Optionally update the existing future lessons (fields, weekday shift).
  // Batched: one UPDATE per schedule (via .in) invece di una per lezione — molto più veloce.
  if (update_future_lessons) {
    const futureLessons = await loadFutureLessons()

    const grouped = new Map<ScheduleOverride, string[]>()
    const shifted: { id: string; date: string; sched: ScheduleOverride }[] = []

    for (const lesson of futureLessons) {
      const jsDay = new Date(lesson.date + 'T12:00:00').getDay()
      const lessonWeekday = JS_DAY_TO_WEEKDAY[jsDay]

      // Match per giorno E ora originale: con più orari nello stesso giorno
      // (es. lunedì 10:00 / 13:00 / 16:15) ogni lezione deve abbinarsi al SUO orario.
      const lessonTime = lesson.start_time?.slice(0, 5)
      const candidates = matchList.filter((s: ScheduleOverride) =>
        (s.original_weekday && s.original_weekday === lessonWeekday) ||
        (!s.original_weekday && s.weekday === lessonWeekday)
      )
      const sched: ScheduleOverride | undefined =
        candidates.find(s => (s.original_start_time ?? s.start_time)?.slice(0, 5) === lessonTime)
        ?? (candidates.length === 1 ? candidates[0] : undefined)
      // Nessun orario corrispondente → NON toccare la lezione.
      // (Il vecchio fallback su matchList[0] rischiava di riscrivere ora/insegnante
      // di tutte le lezioni quando il client inviava orari incompleti.)
      if (!sched) continue

      if (sched.weekday && sched.weekday !== lessonWeekday) {
        // cambio giorno: la data è diversa per ogni lezione, update singolo
        shifted.push({ id: lesson.id, date: shiftToWeekday(lesson.date, sched.weekday), sched })
      } else {
        const ids = grouped.get(sched) ?? []
        ids.push(lesson.id)
        grouped.set(sched, ids)
      }
    }

    const buildUpdate = (sched: ScheduleOverride): Record<string, unknown> => {
      const st = sched.start_time ?? start_time
      const dur = sched.duration_minutes ?? Number(duration_minutes)
      const updateData: Record<string, unknown> = {
        lesson_type_id,
        max_capacity: sched.max_capacity ?? Number(max_capacity) ?? 15,
        teacher_id: sched.teacher_id !== undefined ? (sched.teacher_id || null) : (teacher_id || null),
        room_id: sched.room_id !== undefined ? (sched.room_id || null) : (room_id || null),
        is_online: sched.is_online ?? is_online ?? false,
        online_link: (sched.online_link !== undefined ? sched.online_link : online_link) || null,
      }
      if (st) { updateData.start_time = st; updateData.end_time = calcEndTime(st, dur) }
      return updateData
    }

    for (const [sched, ids] of grouped) {
      const { error: updErr } = await supabase.from('lessons').update(buildUpdate(sched)).in('id', ids)
      if (updErr) console.error('[courses PUT] bulk lesson update error:', updErr.message)
    }
    for (const s of shifted) {
      await supabase.from('lessons').update({ ...buildUpdate(s.sched), date: s.date }).eq('id', s.id)
    }
  }

  // Window management — ALWAYS runs (new schedules and start/end date changes
  // must persist even when the user chooses "update template only")
  const freshLessons = await loadFutureLessons()

  for (const sched of scheduleList) {
    const st = sched.start_time ?? start_time
    if (!st) continue
    const dur = sched.duration_minutes ?? Number(duration_minutes) ?? 60
    const endTime = calcEndTime(st, dur)

    if (sched.is_new) {
      // Nuovo orario inline: genera le lezioni della sua finestra.
      // Salta le date in cui esiste già una lezione allo stesso orario (evita duplicati
      // se l'orario nuovo coincide con uno esistente) e non genera lezioni nel passato.
      if (!sched.start_date) continue
      const endDate = sched.end_date ?? sched.start_date
      const startRaw = sched.start_date < today ? today : sched.start_date
      const firstDate = sched.weekday ? shiftToWeekday(startRaw, sched.weekday) : startRaw
      const occupied = new Set(freshLessons.map(l => `${l.date}|${l.start_time?.slice(0, 5)}`))
      const inserts: Record<string, unknown>[] = []
      const cursor = new Date(firstDate + 'T12:00:00')
      while (cursor.toISOString().split('T')[0] <= endDate && inserts.length < 200) {
        const d = cursor.toISOString().split('T')[0]
        if (!occupied.has(`${d}|${st.slice(0, 5)}`)) {
          inserts.push(lessonFields(sched, d, st, endTime))
        }
        cursor.setDate(cursor.getDate() + 7)
      }
      await insertLessons(inserts, 'new schedule')
      continue
    }

    // Orario esistente — individua le lezioni di questo orario
    const weekday = sched.weekday ?? sched.original_weekday
    if (!weekday) continue

    // Match sull'ora nuova O su quella originale (con "solo modello" le lezioni
    // conservano l'ora vecchia ma appartengono comunque a questo orario)
    const matchTimes = new Set([st.slice(0, 5), (sched.original_start_time ?? st).slice(0, 5)])
    const schedLessons = freshLessons
      .filter(l => JS_DAY_TO_WEEKDAY[new Date(l.date + 'T12:00:00').getDay()] === weekday
        && matchTimes.has(l.start_time?.slice(0, 5) ?? ''))
      .sort((a, b) => a.date.localeCompare(b.date))

    // Colore, piano compensi e online/in presenza si applicano SEMPRE alle
    // lezioni future dell'orario (non toccano date/prenotazioni — e il dialogo
    // di propagazione non scatta per questi campi)
    if (schedLessons.length) {
      const meta: Record<string, unknown> = {}
      if (sched.color !== undefined) meta.color = sched.color
      if (sched.compensation_plan_id !== undefined) meta.compensation_plan_id = sched.compensation_plan_id || null
      if (sched.is_online !== undefined) meta.is_online = sched.is_online
      if (sched.online_link !== undefined) meta.online_link = sched.online_link || null
      if (Object.keys(meta).length) {
        const ids = schedLessons.map(l => l.id)
        let { error: metaErr } = await supabase.from('lessons').update(meta).in('id', ids)
        if (metaErr && meta.color !== undefined && metaErr.message.includes('color')) {
          // colonna color non ancora migrata: applica almeno il resto
          const { color: _c, ...rest } = meta
          metaErr = Object.keys(rest).length
            ? (await supabase.from('lessons').update(rest).in('id', ids)).error
            : null
        }
        if (metaErr) console.error('[courses PUT] meta update error:', metaErr.message)
      }
    }

    // La finestra [data inizio → data fine] è editabile.
    // Le lezioni fuori finestra vengono annullate, quelle mancanti generate.
    if (!sched.start_date && !sched.end_date) continue
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
    // cancel out-of-window lessons (batched)
    const toCancel = schedLessons.filter(l => !desired.has(l.date)).map(l => l.id)
    if (toCancel.length) {
      await supabase.from('lessons').update({ status: 'cancelled' }).in('id', toCancel)
    }
    // insert missing in-window dates
    const inserts: Record<string, unknown>[] = []
    for (const d of desired) {
      if (!existingDates.has(d)) inserts.push(lessonFields(sched, d, st, endTime))
    }
    await insertLessons(inserts, 'window')
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

    // Cancel future lessons (not past, not already cancelled) — tutto in batch:
    // la vecchia versione faceva 2+ chiamate PER LEZIONE (373 lezioni ≈ 750
    // round-trip sequenziali → sembrava bloccato)
    const futureLessons = await fetchAllRows<{ id: string }>((from, to) => supabase
      .from('lessons')
      .select('id')
      .eq('course_id', id)
      .eq('school_id', profile.school_id)
      .gte('date', today)
      .neq('status', 'cancelled')
      .order('id', { ascending: true })
      .range(from, to))

    const lessonIds = futureLessons.map(l => l.id)
    const CHUNK = 100

    // 1. Tutte le prenotazioni confermate di quelle lezioni (query a blocchi)
    type BookingRow = { id: string; access_source: string | null; student_package_id: string | null; student_subscription_id: string | null; credits_deducted: number | null }
    const bookings: BookingRow[] = []
    for (let i = 0; i < lessonIds.length; i += CHUNK) {
      const { data } = await supabase
        .from('bookings')
        .select('id, access_source, student_package_id, student_subscription_id, credits_deducted')
        .in('lesson_id', lessonIds.slice(i, i + CHUNK))
        .eq('status', 'confirmed')
      bookings.push(...(data ?? []))
    }

    // 2. Rimborsi (le prenotazioni sono in genere poche: ok una a una)
    for (const booking of bookings) {
      if (booking.access_source === 'package' && booking.student_package_id && (booking.credits_deducted ?? 0) > 0) {
        const { data: pkg } = await supabase.from('student_packages').select('credits_remaining').eq('id', booking.student_package_id).single()
        if (pkg) {
          await supabase.from('student_packages').update({ credits_remaining: (pkg.credits_remaining ?? 0) + (booking.credits_deducted ?? 0) }).eq('id', booking.student_package_id)
        }
      } else if (booking.access_source === 'subscription' && booking.student_subscription_id) {
        const { data: sub } = await supabase.from('student_subscriptions').select('access_remaining').eq('id', booking.student_subscription_id).single()
        if (sub && sub.access_remaining !== null) {
          await supabase.from('student_subscriptions').update({ access_remaining: (sub.access_remaining ?? 0) + 1 }).eq('id', booking.student_subscription_id)
        }
      }
    }

    // 3. Annulla prenotazioni e lezioni in batch
    const bookingIds = bookings.map(b => b.id)
    for (let i = 0; i < bookingIds.length; i += CHUNK) {
      await supabase.from('bookings')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancellation_type: 'within_policy', credit_refunded: true })
        .in('id', bookingIds.slice(i, i + CHUNK))
    }
    for (let i = 0; i < lessonIds.length; i += CHUNK) {
      await supabase.from('lessons').update({ status: 'cancelled' }).in('id', lessonIds.slice(i, i + CHUNK))
    }

    // Delete the course itself
    await supabase.from('courses').delete().eq('id', id).eq('school_id', profile.school_id)

    console.log(`[courses DELETE] course ${id}: ${lessonIds.length} future classes cancelled, ${bookingIds.length} bookings refunded, course deleted`)
    return NextResponse.json({ deleted: true, classes_cancelled: lessonIds.length })
  } catch (err) {
    console.error('[courses DELETE] unexpected', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
