import { createClient } from '@/lib/supabase/server'
import { getTranslations } from 'next-intl/server'

export default async function TeacherPerformancePage() {
  const t = await getTranslations('teacher.performance')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: teacher } = await supabase
    .from('teachers')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!teacher) {
    return <p className="text-gray-400 text-sm">Teacher profile not found.</p>
  }

  const thisMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

  const { data: attendanceData } = await supabase
    .from('attendance')
    .select('status, marked_at')
    .eq('teacher_id', teacher.id)
    .gte('marked_at', thisMonthStart)

  const total = attendanceData?.length ?? 0
  const present = attendanceData?.filter(a => a.status === 'present').length ?? 0
  const noShow = total - present
  const rate = total > 0 ? Math.round((present / total) * 100) : 0

  // Lessons completed this month
  const { count: lessonsCount } = await supabase
    .from('lessons')
    .select('id', { count: 'exact', head: true })
    .eq('teacher_id', teacher.id)
    .eq('status', 'completed')
    .gte('date', thisMonthStart.split('T')[0])

  const kpis = [
    { label: t('lessonsTeaught'), value: lessonsCount ?? 0 },
    { label: t('studentsFollowed'), value: present },
    { label: t('noShowRate'), value: noShow },
    { label: t('attendanceRate'), value: `${rate}%` },
  ]

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">{t('title')}</h1>

      <div className="grid grid-cols-2 gap-4 mb-8">
        {kpis.map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-gray-100 p-5">
            <p className="text-xs text-gray-400 uppercase tracking-wide">{k.label}</p>
            <p className="text-3xl font-bold text-gray-900 mt-2">{k.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">{t('noData')}</h2>
        {total === 0 ? (
          <p className="text-sm text-gray-400">{t('noData')}</p>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Present</span>
                <span>{present} / {total}</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full"
                  style={{ width: `${rate}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>No-show</span>
                <span>{noShow} / {total}</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-red-400 rounded-full"
                  style={{ width: `${total > 0 ? Math.round((noShow / total) * 100) : 0}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
