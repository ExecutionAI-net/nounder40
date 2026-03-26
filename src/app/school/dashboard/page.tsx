import { createClient } from '@/lib/supabase/server'

export default async function SchoolDashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase
    .from('profiles')
    .select('name, school_sub_role')
    .eq('id', user!.id)
    .single()

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
        {[
          { label: 'Active Students', value: '—' },
          { label: 'Weekly Lessons', value: '—' },
          { label: 'Monthly Revenue', value: '—' },
          { label: 'Active Subscriptions', value: '—' },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-white rounded-xl border border-gray-100 p-5">
            <p className="text-xs text-gray-400 uppercase tracking-wide">{kpi.label}</p>
            <p className="text-3xl font-bold text-gray-900 mt-2">{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 bg-white rounded-xl border border-gray-100 p-6">
        <p className="text-sm text-gray-400">Phase 2 will populate this dashboard with school-specific data.</p>
      </div>
    </div>
  )
}
