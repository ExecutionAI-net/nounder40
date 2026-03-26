import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import SchoolActions from './SchoolActions'

export default async function SchoolDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: school } = await supabase
    .from('schools')
    .select('*')
    .eq('id', id)
    .single()

  if (!school) notFound()

  const { data: locations } = await supabase
    .from('school_locations')
    .select('id, name, address')
    .eq('school_id', id)

  const { count: teacherCount } = await supabase
    .from('teachers')
    .select('*', { count: 'exact', head: true })
    .eq('school_id', id)

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <Link href="/hq/schools" className="text-sm text-gray-400 hover:text-gray-600">← Back to Schools</Link>
        <div className="mt-2 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{school.name}</h1>
            <p className="text-gray-500 text-sm mt-1">{school.city}, {school.country}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs px-2 py-1 rounded-full ${school.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {school.active ? 'Active' : 'Inactive'}
            </span>
            <SchoolActions schoolId={school.id} active={school.active} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wide">Platform Fee</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{school.platform_fee_percentage}%</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wide">Locations</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{locations?.length ?? 0}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wide">Teachers</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{teacherCount ?? 0}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-3">
        <h2 className="font-semibold text-gray-900 mb-4">Details</h2>
        {[
          { label: 'Email', value: school.email },
          { label: 'Phone', value: school.phone ?? '—' },
          { label: 'Address', value: school.address ?? '—' },
          { label: 'Free Trial Ends', value: school.free_trial_ends_at ? new Date(school.free_trial_ends_at).toLocaleDateString() : '—' },
          { label: 'Stripe Connected', value: school.stripe_onboarding_complete ? 'Yes' : 'No' },
          { label: 'Created', value: new Date(school.created_at).toLocaleDateString() },
        ].map(({ label, value }) => (
          <div key={label} className="flex justify-between text-sm">
            <span className="text-gray-400">{label}</span>
            <span className="text-gray-900 font-medium">{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
