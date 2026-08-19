import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// GET /api/school/reports/packages
// Report vendite/uso: tutti i pacchetti e abbonamenti degli studenti della scuola
// (ogni riga = un acquisto, con studente, prodotto, uso e stato).
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
  if (!profile?.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const schoolId = profile.school_id

  const db = createAdminClient()

  const [{ data: packages }, { data: subscriptions }] = await Promise.all([
    db.from('student_packages')
      .select('id, student_id, credits_total, credits_remaining, purchased_at, expires_at, status, payment_method, packages(name_en, name_it, name_es)')
      .eq('school_id', schoolId)
      .order('purchased_at', { ascending: false }),
    db.from('student_subscriptions')
      .select('id, student_id, access_total, access_remaining, started_at, current_period_end, status, subscriptions_catalog(name_en, name_it, name_es)')
      .eq('school_id', schoolId)
      .order('started_at', { ascending: false }),
  ])

  // nomi studenti (student_id = students.id)
  const ids = [...new Set([...(packages ?? []).map(p => p.student_id), ...(subscriptions ?? []).map(sc => sc.student_id)])]
  const { data: students } = ids.length
    ? await db.from('students').select('id, name').in('id', ids)
    : { data: [] }
  const nameMap: Record<string, string> = {}
  for (const st of students ?? []) nameMap[st.id] = st.name

  type LocName = { name_en?: string | null; name_it?: string | null; name_es?: string | null } | null
  const rows = [
    ...(packages ?? []).map(p => ({
      id: p.id,
      kind: 'package' as const,
      student_id: p.student_id,
      student_name: nameMap[p.student_id] ?? '—',
      product: p.packages as unknown as LocName,
      total: p.credits_total,
      remaining: p.credits_remaining,
      started_at: p.purchased_at,
      ends_at: p.expires_at,
      status: p.status,
      payment_method: p.payment_method,
    })),
    ...(subscriptions ?? []).map(sc => ({
      id: sc.id,
      kind: 'subscription' as const,
      student_id: sc.student_id,
      student_name: nameMap[sc.student_id] ?? '—',
      product: sc.subscriptions_catalog as unknown as LocName,
      total: sc.access_total,
      remaining: sc.access_remaining,
      started_at: sc.started_at,
      ends_at: sc.current_period_end,
      status: sc.status,
      payment_method: null as string | null,
    })),
  ].sort((a, b) => (b.started_at ?? '').localeCompare(a.started_at ?? ''))

  return NextResponse.json({ rows })
}
