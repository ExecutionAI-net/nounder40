import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { HQ_PERMISSIONS, PERMISSION_LABELS, ROLE_LABELS } from '@/lib/hq-permissions'
import type { HQSubRole, Permission } from '@/lib/hq-permissions'

const ALL_PERMISSIONS: Permission[] = [
  'dashboard',
  'schools_view',
  'schools_create_edit',
  'schools_activate',
  'schools_platform_fee',
  'payments',
  'reports',
  'inbox',
  'library',
  'shop',
  'packages',
  'lesson_types',
  'team',
  'permissions',
  'homepage_settings',
]

const ROLES: HQSubRole[] = ['owner', 'super_admin', 'operations', 'finance', 'tech_support', 'analytics', 'support']

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

      {profile?.hq_sub_role === 'owner' && (
        <div className="mt-8">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Role Permissions</h2>
            <p className="text-sm text-gray-600 mt-1">Reference guide for team member roles (read-only)</p>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-6 py-3 font-medium text-gray-700 sticky left-0 bg-gray-50 z-10">Permission</th>
                  {ROLES.map((role) => (
                    <th key={role} className="text-center px-4 py-3 font-medium text-gray-700 whitespace-nowrap">
                      {ROLE_LABELS[role]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ALL_PERMISSIONS.map((perm) => (
                  <tr key={perm} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium text-gray-900 sticky left-0 bg-white z-10">
                      {PERMISSION_LABELS[perm]}
                    </td>
                    {ROLES.map((role) => {
                      const hasIt = HQ_PERMISSIONS[role].includes(perm)
                      return (
                        <td key={`${role}-${perm}`} className="text-center px-4 py-3">
                          {hasIt ? (
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100">
                              <svg className="w-3 h-3 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            </span>
                          ) : (
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-100">
                              <span className="text-gray-400">—</span>
                            </span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <p className="text-xs text-blue-800">
              <strong>Note:</strong> This permission matrix is hardcoded and cannot be changed. Use it as a reference when assigning roles to team members in the{' '}
              <Link href="/hq/team" className="text-[#6B1F3A] font-semibold hover:underline">
                Team
              </Link>
              {' '}section.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
