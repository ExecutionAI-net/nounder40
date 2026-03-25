import { createClient } from '@/lib/supabase/server'

export default async function HQDashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase
    .from('profiles')
    .select('name, hq_sub_role')
    .eq('id', user!.id)
    .single()

  return (
    <div>
      <div className="mb-8">
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

      {/* KPI placeholders */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Active Schools', value: '—' },
          { label: 'Total Students', value: '—' },
          { label: 'Weekly Lessons', value: '—' },
          { label: 'Active Subscriptions', value: '—' },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-white rounded-xl border border-gray-100 p-5">
            <p className="text-xs text-gray-400 uppercase tracking-wide">{kpi.label}</p>
            <p className="text-3xl font-bold text-gray-900 mt-2">{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 bg-white rounded-xl border border-gray-100 p-6">
        <p className="text-sm text-gray-400">Phase 2 will populate this dashboard with live network data.</p>
      </div>
    </div>
  )
}
