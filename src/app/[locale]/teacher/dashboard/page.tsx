import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { getTranslations, getLocale } from 'next-intl/server'

export default async function TeacherDashboard() {
  const t = await getTranslations('teacher.dashboard')
  const uiLocale = await getLocale()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('name')
    .eq('id', user.id)
    .single()

  const { data: teacher } = await supabase
    .from('teachers')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  // Compensation plan assignments per school
  const { data: assignments } = teacher ? await supabase
    .from('teacher_schools')
    .select('school_id, schools(name), compensation_plans(name, base_fee, bonus_threshold, bonus_per_student)')
    .eq('teacher_id', teacher.id) : { data: null }

  const today = new Date().toISOString().split('T')[0]

  // Today's lessons
  const { data: todayLessons } = teacher ? await supabase
    .from('lessons')
    .select(`
      id, date, start_time, end_time, current_bookings, max_capacity,
      courses(name, color),
      school_rooms(name, school_locations(name)),
      schools(name)
    `)
    .eq('teacher_id', teacher.id)
    .eq('date', today)
    .in('status', ['scheduled', 'completed'])
    .order('start_time') : { data: null }

  // Upcoming lessons this week
  const weekEnd = new Date()
  weekEnd.setDate(weekEnd.getDate() + 7)
  const { data: upcomingLessons } = teacher ? await supabase
    .from('lessons')
    .select('id, date, start_time, courses(name, color)')
    .eq('teacher_id', teacher.id)
    .gt('date', today)
    .lte('date', weekEnd.toISOString().split('T')[0])
    .eq('status', 'scheduled')
    .order('date')
    .order('start_time') : { data: null }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          {t('greeting', { name: profile?.name?.split(' ')[0] ?? 'Teacher' })}
        </h1>
        <p className="text-gray-500 mt-1">{t('subtitleSchedule')}</p>
      </div>

      {/* Today */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{t('sectionToday')}</h2>
        {!todayLessons || todayLessons.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-6 text-sm text-gray-400">
            {t('noLessonToday')}
          </div>
        ) : (
          <div className="space-y-3">
            {todayLessons.map(lesson => {
              const course = lesson.courses as unknown as { name: string; color: string } | null
              const room = lesson.school_rooms as unknown as { name: string; school_locations: { name: string } | null } | null
              const school = lesson.schools as unknown as { name: string } | null
              return (
                <div key={lesson.id} className="bg-white rounded-xl border border-gray-100 p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: course?.color ?? '#6B1F3A' }}
                    />
                    <div>
                      <p className="font-medium text-gray-900 text-sm">{course?.name ?? 'Lesson'}</p>
                      <p className="text-xs text-gray-400">
                        {lesson.start_time?.slice(0, 5)} — {room?.name ?? ''} · {school?.name ?? ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400">{lesson.current_bookings}/{lesson.max_capacity}</span>
                    <Link
                      href={`/teacher/attendance/${lesson.id}`}
                      className="text-xs bg-gray-800 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700 transition"
                    >
                      {t('buttonAttendance')}
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Upcoming */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{t('sectionUpcoming')}</h2>
        {!upcomingLessons || upcomingLessons.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-6 text-sm text-gray-400">
            {t('noUpcomingLessons')}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
            {upcomingLessons.map(lesson => {
              const course = lesson.courses as unknown as { name: string; color: string } | null
              return (
                <div key={lesson.id} className="px-4 py-3 flex items-center gap-3">
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: course?.color ?? '#6B1F3A' }}
                  />
                  <span className="text-sm text-gray-900">{course?.name}</span>
                  <span className="text-xs text-gray-400 ml-auto">
                    {new Date(lesson.date).toLocaleDateString(uiLocale, { weekday: 'short', month: 'short', day: 'numeric' })} · {lesson.start_time?.slice(0, 5)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Compensation Plans */}
      {assignments && assignments.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{t('sectionCompensationPlans')}</h2>
          <div className="space-y-2">
            {assignments.map((a, i) => {
              const school = a.schools as unknown as { name: string } | null
              const plan = a.compensation_plans as unknown as { name: string; base_fee: number; bonus_threshold: number; bonus_per_student: number } | null
              const tooltipText = plan
                ? t('tooltipBaseFee', { baseFee: plan.base_fee, bonusPerStudent: plan.bonus_per_student, bonusThreshold: plan.bonus_threshold })
                : t('noCompensationMessage')
              return (
                <div key={i} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center justify-between">
                  <p className="text-sm text-gray-700 font-medium">{school?.name ?? '—'}</p>
                  <div className="group relative">
                    {plan ? (
                      <span className="text-xs font-medium text-gray-700 bg-gray-100 px-2.5 py-1 rounded-full cursor-default">
                        {plan.name}
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full cursor-default">
                        {t('noCompensationPlan')}
                      </span>
                    )}
                    <div className="absolute bottom-full right-0 mb-1.5 hidden group-hover:block z-10 w-64">
                      <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 leading-relaxed shadow-lg">
                        {tooltipText}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
