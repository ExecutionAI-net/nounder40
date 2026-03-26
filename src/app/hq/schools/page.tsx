import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export default async function SchoolsPage() {
  const supabase = await createClient()
  const { data: schools } = await supabase
    .from('schools')
    .select('id, name, city, country, email, active, platform_fee_percentage, created_at')
    .order('created_at', { ascending: false })

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Schools</h1>
          <p className="text-gray-500 text-sm mt-1">{schools?.length ?? 0} schools in the network</p>
        </div>
        <Link
          href="/hq/schools/new"
          className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition"
        >
          + New School
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {!schools?.length ? (
          <div className="p-8 text-center text-sm text-gray-400">No schools yet.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">School</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">City</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Platform Fee</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Status</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {schools.map((school) => (
                <tr key={school.id} className="hover:bg-gray-50 transition">
                  <td className="px-6 py-3">
                    <Link href={`/hq/schools/${school.id}`} className="font-medium text-gray-900 hover:text-[#6B1F3A]">
                      {school.name}
                    </Link>
                    <p className="text-xs text-gray-400">{school.email}</p>
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-600">{school.city}{school.country ? `, ${school.country}` : ''}</td>
                  <td className="px-6 py-3 text-sm text-gray-600">{school.platform_fee_percentage}%</td>
                  <td className="px-6 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${school.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {school.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-400">
                    {new Date(school.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
