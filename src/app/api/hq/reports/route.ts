import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { hasPermission } from '@/lib/hq-permissions'
import type { HQSubRole } from '@/lib/hq-permissions'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify HQ member with reports permission
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, roles, hq_sub_role')
    .eq('id', user.id)
    .single()

  const isHQ = profile?.role === 'hq' || profile?.roles?.includes('hq')
  const role = profile?.hq_sub_role as HQSubRole
  if (!isHQ || !hasPermission(role, 'reports')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  // Fetch all schools
  const { data: allSchools } = await supabase
    .from('schools')
    .select('id, name, city, country, active')
    .order('name')

  const schools = allSchools ?? []

  const schoolIds = schools.map((s) => s.id)
  const monthStartDate = monthStart.slice(0, 10)

  // 7 parallel batch queries — one per data type, not one per school
  const [
    { count: totalStudents },
    { count: totalTeachers },
    { data: monthTx },
    { data: allSchoolStudents },
    { data: allSchoolTeachers },
    { data: allSchoolLessons },
    { data: allSchoolTx },
  ] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'student'),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'teacher'),
    supabase.from('transactions').select('amount').eq('status', 'completed').gte('created_at', monthStart),
    schoolIds.length
      ? supabase.from('school_students').select('school_id').in('school_id', schoolIds)
      : Promise.resolve({ data: [] as { school_id: string }[] }),
    schoolIds.length
      ? supabase.from('teacher_schools').select('school_id').in('school_id', schoolIds).eq('active', true)
      : Promise.resolve({ data: [] as { school_id: string }[] }),
    schoolIds.length
      ? supabase.from('lessons').select('school_id').in('school_id', schoolIds).gte('date', monthStartDate)
      : Promise.resolve({ data: [] as { school_id: string }[] }),
    schoolIds.length
      ? supabase.from('transactions').select('school_id, amount').in('school_id', schoolIds).eq('status', 'completed').gte('created_at', monthStart)
      : Promise.resolve({ data: [] as { school_id: string; amount: number }[] }),
  ])

  const monthlyRevenue = (monthTx ?? []).reduce((sum, tx) => sum + (tx.amount ?? 0), 0)

  // Aggregate per-school counts client-side
  const stuBySchool: Record<string, number> = {}
  for (const row of allSchoolStudents ?? []) {
    stuBySchool[row.school_id] = (stuBySchool[row.school_id] ?? 0) + 1
  }
  const teachBySchool: Record<string, number> = {}
  for (const row of allSchoolTeachers ?? []) {
    teachBySchool[row.school_id] = (teachBySchool[row.school_id] ?? 0) + 1
  }
  const lessBySchool: Record<string, number> = {}
  for (const row of allSchoolLessons ?? []) {
    lessBySchool[row.school_id] = (lessBySchool[row.school_id] ?? 0) + 1
  }
  const revBySchool: Record<string, number> = {}
  for (const row of allSchoolTx ?? []) {
    revBySchool[row.school_id] = (revBySchool[row.school_id] ?? 0) + (row.amount ?? 0)
  }

  const schoolRows = schools.map((school) => ({
    id: school.id,
    name: school.name,
    city: school.city ?? '',
    country: school.country ?? '',
    active: school.active ?? false,
    students: stuBySchool[school.id] ?? 0,
    teachers: teachBySchool[school.id] ?? 0,
    lessons_this_month: lessBySchool[school.id] ?? 0,
    revenue_this_month: revBySchool[school.id] ?? 0,
  }))

  return NextResponse.json({
    kpis: {
      active_schools: schools.filter((s) => s.active).length,
      inactive_schools: schools.filter((s) => !s.active).length,
      total_students: totalStudents ?? 0,
      total_teachers: totalTeachers ?? 0,
      monthly_revenue: monthlyRevenue,
    },
    schools: schoolRows,
  })
}
