import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export default async function StudentDashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [{ data: profile }, { data: packages }, { data: bookings }] = await Promise.all([
    supabase.from('profiles').select('name, city').eq('id', user.id).single(),
    supabase.from('student_packages').select('credits_remaining').eq('student_id', user.id).eq('status', 'active').gt('credits_remaining', 0).gte('expires_at', new Date().toISOString()),
    supabase.from('bookings').select('id, status, lessons(date)').eq('student_id', user.id).eq('status', 'confirmed'),
  ])

  const totalCredits = (packages ?? []).reduce((sum, p) => sum + p.credits_remaining, 0)
  const today = new Date().toISOString().split('T')[0]
  const upcomingCount = (bookings ?? []).filter((b) => {
    const lesson = b.lessons as unknown as { date: string } | null
    return lesson && lesson.date >= today
  }).length

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Hi, {profile?.name?.split(' ')[0] ?? 'there'} 👋
        </h1>
        <p className="text-gray-500 mt-1">Ready for your next class?</p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        {[
          { label: 'Credits', value: totalCredits },
          { label: 'Upcoming Lessons', value: upcomingCount },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-white rounded-xl border border-gray-100 p-5">
            <p className="text-xs text-gray-400 uppercase tracking-wide">{kpi.label}</p>
            <p className="text-3xl font-bold text-[#6B1F3A] mt-2">{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link href="/student/book" className="bg-[#6B1F3A] text-white rounded-xl p-5 hover:bg-[#5a1930] transition">
          <p className="font-semibold">Book a Class</p>
          <p className="text-xs opacity-70 mt-0.5">Browse upcoming lessons</p>
        </Link>
        <Link href="/student/bookings" className="bg-white border border-gray-100 rounded-xl p-5 hover:bg-gray-50 transition">
          <p className="font-semibold text-gray-900">My Lessons</p>
          <p className="text-xs text-gray-400 mt-0.5">View your bookings</p>
        </Link>
        <Link href="/student/packages" className="bg-white border border-gray-100 rounded-xl p-5 hover:bg-gray-50 transition">
          <p className="font-semibold text-gray-900">My Access</p>
          <p className="text-xs text-gray-400 mt-0.5">{totalCredits} credit(s) available</p>
        </Link>
        <Link href="/student/profile" className="bg-white border border-gray-100 rounded-xl p-5 hover:bg-gray-50 transition">
          <p className="font-semibold text-gray-900">Profile</p>
          <p className="text-xs text-gray-400 mt-0.5">Your account details</p>
        </Link>
      </div>
    </div>
  )
}
