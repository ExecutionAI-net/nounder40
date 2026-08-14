import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = admin()
  const { data: student } = await db.from('students').select('id').eq('user_id', user.id).single()
  if (!student) return NextResponse.json({ totalCredits: 0, packages: [], history: [] })

  const [{ data: packages, error: pkgErr }, { data: allPackages }, { data: bookings }] = await Promise.all([
    db
      .from('student_packages')
      .select('id, credits_total, credits_remaining, expires_at, status, packages(name_en, color), schools(name)')
      .eq('student_id', student.id)
      .eq('status', 'active')
      .gt('credits_remaining', 0)
      .gte('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: true }),
    db
      .from('student_packages')
      .select('id, credits_total, purchased_at, payment_method, packages(name_en), schools(name)')
      .eq('student_id', student.id)
      .order('purchased_at', { ascending: false })
      .limit(50),
    db
      .from('bookings')
      .select('id, credits_deducted, credit_refunded, status, booked_at, cancelled_at, access_source, student_package_id, lessons(date, lesson_types(name_en)), schools(name), student_packages(packages(name_en))')
      .eq('student_id', student.id)
      .order('booked_at', { ascending: false })
      .limit(50),
  ])

  console.log('[credits] student.id:', student.id, 'packages count:', packages?.length ?? 0, 'error:', pkgErr?.message ?? 'none')

  const totalCredits = (packages ?? []).reduce((sum, p) => sum + p.credits_remaining, 0)

  const bookingHistory = (bookings ?? [])
    .filter((b) => b.access_source === 'package' || (b.credits_deducted && b.credits_deducted > 0))
    .flatMap((b) => {
      const lesson = b.lessons as unknown as { date: string; lesson_types: { name_en: string } | null } | null
      const school = b.schools as unknown as { name: string } | null
      const pkg = b.student_packages as unknown as { packages: { name_en: string } | null } | null
      const lessonName = lesson?.lesson_types?.name_en ?? 'Lesson'
      const schoolName = school?.name ?? ''
      const packageName = pkg?.packages?.name_en ?? null
      const deductedCredits = b.credits_deducted ?? 0

      const base = {
        lesson_date: lesson?.date ?? null,
        lesson_name: lessonName,
        school_name: schoolName,
        package_name: packageName,
        student_package_id: b.student_package_id ?? null,
        status: b.status,
      }

      // Cancelled with refund → show both the original deduction and the refund
      if (b.status === 'cancelled' && b.credit_refunded && deductedCredits > 0) {
        return [
          { ...base, id: `${b.id}-deduct`, date: b.booked_at, credits: -deductedCredits, type: 'deducted' },
          { ...base, id: `${b.id}-refund`, date: b.cancelled_at ?? b.booked_at, credits: +deductedCredits, type: 'refund' },
        ]
      }

      // Cancelled without refund (burned) or no-show
      if (b.status === 'cancelled' && !b.credit_refunded) {
        return [{ ...base, id: b.id, date: b.booked_at, credits: -deductedCredits, type: 'no_show' }]
      }

      // Confirmed / attended / no_show
      let historyType: string
      if (b.status === 'no_show') historyType = 'no_show'
      else historyType = 'deducted'
      return [{ ...base, id: b.id, date: b.booked_at, credits: -deductedCredits, type: historyType }]
    })

  const purchaseHistory = (allPackages ?? []).map((p) => {
    const pkg = p.packages as unknown as { name_en: string } | null
    const school = p.schools as unknown as { name: string } | null
    return {
      id: `purchase-${p.id}`,
      date: p.purchased_at,
      lesson_date: null,
      lesson_name: pkg?.name_en ?? 'Package',
      school_name: school?.name ?? '',
      credits: p.credits_total,
      type: 'purchase',
      status: 'completed',
    }
  })

  const history = [...bookingHistory, ...purchaseHistory].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  )

  return NextResponse.json({ totalCredits, packages: packages ?? [], history })
}
