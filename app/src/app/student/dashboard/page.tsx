import { createClient } from '@/lib/supabase/server'

export default async function StudentDashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase
    .from('profiles')
    .select('name')
    .eq('id', user!.id)
    .single()

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Hi, {profile?.name?.split(' ')[0] ?? 'there'} 👋
        </h1>
        <p className="text-gray-500 mt-1">Ready for your next class?</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {[
          { label: 'Credits', value: '—' },
          { label: 'Upcoming Lessons', value: '—' },
          { label: 'Total Classes', value: '—' },
          { label: 'Streak', value: '—' },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-white rounded-xl border border-gray-100 p-5">
            <p className="text-xs text-gray-400 uppercase tracking-wide">{kpi.label}</p>
            <p className="text-3xl font-bold text-[#6B1F3A] mt-2">{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 bg-white rounded-xl border border-gray-100 p-6">
        <p className="text-sm text-gray-400">Phase 4 will enable booking and display live credit balances.</p>
      </div>
    </div>
  )
}
