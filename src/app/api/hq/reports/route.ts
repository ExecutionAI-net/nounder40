import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { hasPermission } from '@/lib/hq-permissions'
import type { HQSubRole } from '@/lib/hq-permissions'

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

  // Count students (profiles with role = 'student')
  const { count: totalStudents } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('role', 'student')

  // Count teachers (profiles with role = 'teacher')
  const { count: totalTeachers } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('role', 'teacher')

  // Monthly revenue (sum of completed transactions this month)
  const { data: monthTx } = await supabase
    .from('transactions')
    .select('amount')
    .eq('status', 'completed')
    .gte('created_at', monthStart)

  const monthlyRevenue = (monthTx ?? []).reduce((sum, tx) => sum + (tx.amount ?? 0), 0)

  // Per-school: students, teachers, lessons this month, revenue this month
  const schoolRows = await Promise.all(
    schools.map(async (school) => {
      const [
        { count: stuCount },
        { count: teachCount },
        { count: lessonCount },
        { data: revData },
      ] = await Promise.all([
        supabase
          .from('school_students')
          .select('*', { count: 'exact', head: true })
          .eq('school_id', school.id),
        supabase
          .from('teacher_schools')
          .select('*', { count: 'exact', head: true })
          .eq('school_id', school.id)
          .eq('active', true),
        supabase
          .from('lessons')
          .select('*', { count: 'exact', head: true })
          .eq('school_id', school.id)
          .gte('date', monthStart.slice(0, 10)),
        supabase
          .from('transactions')
          .select('amount')
          .eq('school_id', school.id)
          .eq('status', 'completed')
          .gte('created_at', monthStart),
      ])

      const revenue = (revData ?? []).reduce((sum, tx) => sum + (tx.amount ?? 0), 0)

      return {
        id: school.id,
        name: school.name,
        city: school.city ?? '',
        country: school.country ?? '',
        active: school.active ?? false,
        students: stuCount ?? 0,
        teachers: teachCount ?? 0,
        lessons_this_month: lessonCount ?? 0,
        revenue_this_month: revenue,
      }
    })
  )

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
