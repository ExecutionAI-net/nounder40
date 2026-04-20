import { createClient } from '@/lib/supabase/server'

function KpiCard({ label, value, tooltip }: { label: string; value: string | number; tooltip: string }) {
  return (
    <div className="relative group bg-white rounded-xl border border-gray-100 p-5">
      <p className="text-xs text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="text-3xl font-bold text-gray-900 mt-2">{value}</p>
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10 w-56">
        <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 text-center shadow-lg">
          {tooltip}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
        </div>
      </div>
    </div>
  )
}

export default async function SchoolDashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('name, school_sub_role, school_id')
    .eq('id', user!.id)
    .single()

  const schoolId = profile?.school_id

  let activeStudents = 0
  let weeklyLessons = 0
  let monthlyRevenue = 0
  let activeSubscriptions = 0

  if (schoolId) {
    const now = new Date()
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1)) // Monday
    weekStart.setHours(0, 0, 0, 0)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekStart.getDate() + 6)
    weekEnd.setHours(23, 59, 59, 999)

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

    const [studentsRes, lessonsRes, revenueRes, subsRes] = await Promise.all([
      supabase
        .from('school_students')
        .select('id', { count: 'exact', head: true })
        .eq('school_id', schoolId),
      supabase
        .from('lessons')
        .select('id', { count: 'exact', head: true })
        .eq('school_id', schoolId)
        .gte('date', weekStart.toISOString().split('T')[0])
        .lte('date', weekEnd.toISOString().split('T')[0])
        .neq('status', 'cancelled'),
      supabase
        .from('transactions')
        .select('school_amount')
        .eq('school_id', schoolId)
        .eq('status', 'completed')
        .gte('created_at', monthStart),
      supabase
        .from('student_subscriptions')
        .select('id', { count: 'exact', head: true })
        .eq('school_id', schoolId)
        .eq('status', 'active'),
    ])

    activeStudents = studentsRes.count ?? 0
    weeklyLessons = lessonsRes.count ?? 0
    monthlyRevenue = (revenueRes.data ?? []).reduce((sum, tx) => sum + (tx.school_amount ?? 0), 0)
    activeSubscriptions = subsRes.count ?? 0
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">School Dashboard</h1>
        <p className="text-gray-500 mt-1">
          Welcome back, {profile?.name ?? user?.email}
          {profile?.school_sub_role && (
            <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full uppercase tracking-wide">
              {profile.school_sub_role}
            </span>
          )}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Active Students"
          value={activeStudents}
          tooltip="Total students enrolled at this school"
        />
        <KpiCard
          label="Weekly Lessons"
          value={weeklyLessons}
          tooltip="Scheduled and completed lessons this week (Mon–Sun)"
        />
        <KpiCard
          label="Monthly Revenue"
          value={`€${monthlyRevenue.toFixed(2)}`}
          tooltip="Total school revenue this month after platform fee deduction"
        />
        <KpiCard
          label="Active Subscriptions"
          value={activeSubscriptions}
          tooltip="Students with an active subscription at this school"
        />
      </div>
    </div>
  )
}
