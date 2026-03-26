import { createClient } from '@/lib/supabase/server'

export default async function TeacherProfilePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: teacher } = await supabase
    .from('teachers')
    .select('name, email, phone, bio, photo_url')
    .eq('user_id', user.id)
    .maybeSingle()

  // Schools assigned
  const { data: schools } = await supabase
    .from('teacher_schools')
    .select('schools(name, city), compensation_plans(name)')
    .eq('teacher_id', (await supabase.from('teachers').select('id').eq('user_id', user.id).single()).data?.id ?? '')
    .eq('active', true)

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Profile</h1>

      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4 mb-6">
        <div>
          <p className="text-xs text-gray-400 mb-0.5">Name</p>
          <p className="text-sm font-medium text-gray-900">{teacher?.name ?? '—'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-0.5">Email</p>
          <p className="text-sm text-gray-700">{teacher?.email ?? user.email}</p>
        </div>
        {teacher?.phone && (
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Phone</p>
            <p className="text-sm text-gray-700">{teacher.phone}</p>
          </div>
        )}
        {teacher?.bio && (
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Bio</p>
            <p className="text-sm text-gray-700">{teacher.bio}</p>
          </div>
        )}
      </div>

      {schools && schools.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Schools</h2>
          <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
            {schools.map((s, i) => {
              const school = s.schools as unknown as { name: string; city: string } | null
              const plan = s.compensation_plans as unknown as { name: string } | null
              return (
                <div key={i} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{school?.name}</p>
                    <p className="text-xs text-gray-400">{school?.city}</p>
                  </div>
                  {plan && (
                    <span className="text-xs text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">
                      {plan.name}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
