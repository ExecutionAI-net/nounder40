import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { roleHasPermission } from '@/lib/api/role-permissions'

export const dynamic = 'force-dynamic'

// Report HQ a 3 tab: ?tab=schools|teachers|students&from=YYYY-MM-DD&to=YYYY-MM-DD
// Le metriche "di periodo" (lezioni, ricavi, prenotazioni, presenze) usano
// l'intervallo richiesto; anagrafiche e crediti sono lo stato attuale.
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, roles, hq_sub_role')
    .eq('id', user.id)
    .single()

  const isHQ = profile?.role === 'hq' || profile?.roles?.includes('hq')
  if (!isHQ || !(await roleHasPermission(profile?.hq_sub_role, 'reports'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const tab = searchParams.get('tab') ?? 'schools'
  const now = new Date()
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  const from = searchParams.get('from') || defaultFrom
  const to = searchParams.get('to') || now.toISOString().slice(0, 10)
  const fromTs = `${from}T00:00:00Z`
  const toTs = `${to}T23:59:59Z`

  const db = createAdminClient()

  // ── Tab Scuole ────────────────────────────────────────────────────────────
  if (tab === 'schools') {
    const { data: schools } = await db
      .from('schools')
      .select('id, name, city, country, active, platform_fee_percentage, shop_commission_percentage')
      .order('name')
    const rows = schools ?? []
    const ids = rows.map(s => s.id)

    const [
      { data: schoolStudents },
      { data: schoolTeachers },
      { data: lessons },
      { data: transactions },
      { data: shopSales },
    ] = await Promise.all([
      ids.length ? db.from('school_students').select('school_id').in('school_id', ids) : Promise.resolve({ data: [] }),
      ids.length ? db.from('teacher_schools').select('school_id').in('school_id', ids).eq('active', true) : Promise.resolve({ data: [] }),
      ids.length ? db.from('lessons').select('school_id, status').in('school_id', ids).gte('date', from).lte('date', to) : Promise.resolve({ data: [] }),
      ids.length ? db.from('transactions').select('school_id, amount').in('school_id', ids).eq('status', 'completed').gte('created_at', fromTs).lte('created_at', toTs) : Promise.resolve({ data: [] }),
      db.from('shop_sales').select('school_id, total, commission').gte('created_at', fromTs).lte('created_at', toTs),
    ])

    const count = (list: { school_id: string }[] | null) => {
      const m: Record<string, number> = {}
      for (const r of list ?? []) m[r.school_id] = (m[r.school_id] ?? 0) + 1
      return m
    }
    const stu = count(schoolStudents as { school_id: string }[])
    const tea = count(schoolTeachers as { school_id: string }[])
    const les = count((lessons as { school_id: string; status: string }[] | null)?.filter(l => l.status !== 'cancelled') ?? [])
    const rev: Record<string, number> = {}
    for (const r of (transactions as { school_id: string; amount: number }[]) ?? []) {
      rev[r.school_id] = (rev[r.school_id] ?? 0) + Number(r.amount ?? 0)
    }
    const shopComm: Record<string, number> = {}
    let shopTotal = 0
    for (const r of (shopSales as { school_id: string | null; total: number; commission: number }[]) ?? []) {
      shopTotal += Number(r.total ?? 0)
      if (r.school_id) shopComm[r.school_id] = (shopComm[r.school_id] ?? 0) + Number(r.commission ?? 0)
    }

    const data = rows.map(s => ({
      id: s.id,
      name: s.name,
      city: s.city ?? '',
      country: s.country ?? '',
      active: s.active ?? false,
      platform_fee: Number(s.platform_fee_percentage ?? 0),
      shop_commission_pct: Number(s.shop_commission_percentage ?? 0),
      students: stu[s.id] ?? 0,
      teachers: tea[s.id] ?? 0,
      lessons: les[s.id] ?? 0,
      revenue: Math.round((rev[s.id] ?? 0) * 100) / 100,
      shop_commission: Math.round((shopComm[s.id] ?? 0) * 100) / 100,
    }))

    return NextResponse.json({
      kpis: {
        active_schools: rows.filter(s => s.active).length,
        total_students: Object.values(stu).reduce((a, b) => a + b, 0),
        total_teachers: Object.values(tea).reduce((a, b) => a + b, 0),
        revenue: Math.round(data.reduce((a, s) => a + s.revenue, 0) * 100) / 100,
        shop_revenue: Math.round(shopTotal * 100) / 100,
      },
      rows: data,
    })
  }

  // ── Tab Insegnanti ────────────────────────────────────────────────────────
  if (tab === 'teachers') {
    const [{ data: teachers }, { data: assignments }, { data: lessons }, { data: attendance }] = await Promise.all([
      db.from('teachers').select('id, name, email, active').order('name'),
      db.from('teacher_schools').select('teacher_id, schools(name)').eq('active', true),
      db.from('lessons').select('teacher_id, status, start_time, end_time').gte('date', from).lte('date', to),
      db.from('attendance').select('teacher_id, status, lessons!inner(date)').gte('lessons.date', from).lte('lessons.date', to),
    ])

    const schoolsByTeacher: Record<string, string[]> = {}
    for (const a of (assignments as unknown as { teacher_id: string; schools: { name: string } | null }[]) ?? []) {
      if (!a.schools?.name) continue
      ;(schoolsByTeacher[a.teacher_id] ??= []).push(a.schools.name)
    }

    const lessonAgg: Record<string, { count: number; minutes: number }> = {}
    for (const l of (lessons as { teacher_id: string | null; status: string; start_time: string; end_time: string }[]) ?? []) {
      if (!l.teacher_id || l.status === 'cancelled') continue
      const agg = (lessonAgg[l.teacher_id] ??= { count: 0, minutes: 0 })
      agg.count += 1
      if (l.start_time && l.end_time) {
        const [sh, sm] = l.start_time.split(':').map(Number)
        const [eh, em] = l.end_time.split(':').map(Number)
        const mins = (eh * 60 + em) - (sh * 60 + sm)
        if (mins > 0) agg.minutes += mins
      }
    }

    const attAgg: Record<string, { present: number; noShow: number }> = {}
    for (const a of (attendance as unknown as { teacher_id: string | null; status: string }[]) ?? []) {
      if (!a.teacher_id) continue
      const agg = (attAgg[a.teacher_id] ??= { present: 0, noShow: 0 })
      if (a.status === 'present') agg.present += 1
      else if (a.status === 'no_show') agg.noShow += 1
    }

    const data = ((teachers as { id: string; name: string; email: string | null; active: boolean }[]) ?? []).map(tch => {
      const la = lessonAgg[tch.id] ?? { count: 0, minutes: 0 }
      const aa = attAgg[tch.id] ?? { present: 0, noShow: 0 }
      const marked = aa.present + aa.noShow
      return {
        id: tch.id,
        name: tch.name,
        email: tch.email ?? '',
        active: tch.active,
        schools: (schoolsByTeacher[tch.id] ?? []).join(', '),
        lessons: la.count,
        hours: Math.round(la.minutes / 6) / 10, // 1 decimale
        present: aa.present,
        no_show: aa.noShow,
        attendance_rate: marked > 0 ? Math.round((aa.present / marked) * 100) : null,
      }
    })

    return NextResponse.json({
      kpis: {
        total_teachers: data.length,
        active_teachers: data.filter(d => d.active).length,
        lessons: data.reduce((a, d) => a + d.lessons, 0),
        hours: Math.round(data.reduce((a, d) => a + d.hours, 0) * 10) / 10,
        no_shows: data.reduce((a, d) => a + d.no_show, 0),
      },
      rows: data,
    })
  }

  // ── Tab Studenti ──────────────────────────────────────────────────────────
  if (tab === 'students') {
    const [{ data: students }, { data: bookings }, { data: packages }, { data: transactions }, { data: shopSales }] = await Promise.all([
      db.from('students').select('id, name, email, city, created_at, school_id, schools(name)').order('name').limit(2000),
      db.from('bookings').select('student_id, status').gte('booked_at', fromTs).lte('booked_at', toTs),
      db.from('student_packages').select('student_id, credits_remaining, status').eq('status', 'active'),
      db.from('transactions').select('student_id, amount').eq('status', 'completed').gte('created_at', fromTs).lte('created_at', toTs),
      db.from('shop_sales').select('student_id, total').gte('created_at', fromTs).lte('created_at', toTs),
    ])

    const bookAgg: Record<string, { total: number; attended: number; noShow: number; cancelled: number }> = {}
    for (const b of (bookings as { student_id: string; status: string }[]) ?? []) {
      const agg = (bookAgg[b.student_id] ??= { total: 0, attended: 0, noShow: 0, cancelled: 0 })
      agg.total += 1
      if (b.status === 'attended') agg.attended += 1
      else if (b.status === 'no_show') agg.noShow += 1
      else if (b.status === 'cancelled') agg.cancelled += 1
    }
    const creditsByStudent: Record<string, number> = {}
    for (const p of (packages as { student_id: string; credits_remaining: number }[]) ?? []) {
      creditsByStudent[p.student_id] = (creditsByStudent[p.student_id] ?? 0) + (p.credits_remaining ?? 0)
    }
    const spendByStudent: Record<string, number> = {}
    for (const tx of (transactions as { student_id: string | null; amount: number }[]) ?? []) {
      if (tx.student_id) spendByStudent[tx.student_id] = (spendByStudent[tx.student_id] ?? 0) + Number(tx.amount ?? 0)
    }
    for (const s of (shopSales as { student_id: string | null; total: number }[]) ?? []) {
      if (s.student_id) spendByStudent[s.student_id] = (spendByStudent[s.student_id] ?? 0) + Number(s.total ?? 0)
    }

    const data = ((students as unknown as { id: string; name: string; email: string | null; city: string | null; created_at: string; school_id: string | null; schools: { name: string } | null }[]) ?? []).map(s => {
      const b = bookAgg[s.id] ?? { total: 0, attended: 0, noShow: 0, cancelled: 0 }
      return {
        id: s.id,
        name: s.name,
        email: s.email ?? '',
        city: s.city ?? '',
        school: s.schools?.name ?? '',
        school_id: s.school_id,
        created_at: s.created_at,
        bookings: b.total,
        attended: b.attended,
        no_show: b.noShow,
        cancelled: b.cancelled,
        credits: creditsByStudent[s.id] ?? 0,
        spend: Math.round((spendByStudent[s.id] ?? 0) * 100) / 100,
      }
    })

    const newInPeriod = data.filter(d => d.created_at >= fromTs && d.created_at <= toTs).length

    return NextResponse.json({
      kpis: {
        total_students: data.length,
        new_students: newInPeriod,
        bookings: data.reduce((a, d) => a + d.bookings, 0),
        attended: data.reduce((a, d) => a + d.attended, 0),
        spend: Math.round(data.reduce((a, d) => a + d.spend, 0) * 100) / 100,
      },
      rows: data,
    })
  }

  return NextResponse.json({ error: 'Invalid tab' }, { status: 400 })
}
