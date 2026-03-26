import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export default async function HQDashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase
    .from('profiles')
    .select('name, hq_sub_role')
    .eq('id', user!.id)
    .single()

  const [{ count: activeSchools }, { count: totalStudents }] = await Promise.all([
    supabase.from('schools').select('*', { count: 'exact', head: true }).eq('active', true),
    supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'student'),
  ])

  const { data: recentSchools } = await supabase
    .from('schools')
    .select('id, name, city, country, active, created_at')
    .order('created_at', { ascending: false })
    .limit(5)

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">HQ Dashboard</h1>
          <p className="text-gray-500 mt-1">
            Welcome back, {profile?.name ?? user?.email}
            {profile?.hq_sub_role && (
              <span className="ml-2 text-xs bg-[#6B1F3A]/10 text-[#6B1F3A] px-2 py-0.5 rounded-full uppercase tracking-wide">
                {profile.hq_sub_role.replace('_', ' ')}
              </span>
            )}
          </p>
        </div>
        <Link
          href="/hq/schools/new"
          className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition"
        >
          + New School
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Active Schools', value: activeSchools ?? 0 },
          { label: 'Total Students', value: totalStudents ?? 0 },
          { label: 'Weekly Lessons', value: '—' },
          { label: 'Active Subscriptions', value: '—' },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-white rounded-xl border border-gray-100 p-5">
            <p className="text-xs text-gray-400 uppercase tracking-wide">{kpi.label}</p>
            <p className="text-3xl font-bold text-gray-900 mt-2">{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-100">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Recent Schools</h2>
          <Link href="/hq/schools" className="text-sm text-[#6B1F3A] hover:underline">View all</Link>
        </div>
        {!recentSchools?.length ? (
          <div className="px-6 py-8 text-center text-sm text-gray-400">
            No schools yet.{' '}
            <Link href="/hq/schools/new" className="text-[#6B1F3A] hover:underline">
              Create the first one →
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {recentSchools.map((school) => (
              <Link
                key={school.id}
                href={`/hq/schools/${school.id}`}
                className="flex items-center px-6 py-3 hover:bg-gray-50 transition"
              >
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">{school.name}</p>
                  <p className="text-xs text-gray-400">{school.city}, {school.country}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${school.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {school.active ? 'Active' : 'Inactive'}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
