import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: studentRecord } = await supabase
    .from('students')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!studentRecord) return NextResponse.json({ totalCredits: 0, packages: [], history: [] })

  const [{ data: packages }, { data: bookings }] = await Promise.all([
    supabase
      .from('student_packages')
      .select('id, credits_total, credits_remaining, expires_at, status, packages(name_en, color), schools(name)')
      .eq('student_id', studentRecord.id)
      .eq('status', 'active')
      .gte('expires_at', new Date().toISOString()),
    supabase
      .from('bookings')
      .select('id, credits_deducted, credit_refunded, status, booked_at, access_source, lessons(date, lesson_types(name_en)), schools(name)')
      .eq('student_id', studentRecord.id)
      .order('booked_at', { ascending: false })
      .limit(50),
  ])

  const totalCredits = (packages ?? []).reduce((sum, p) => sum + p.credits_remaining, 0)

  const history = (bookings ?? [])
    .filter((b) => b.access_source === 'package' || (b.credits_deducted && b.credits_deducted > 0))
    .map((b) => {
      const lesson = b.lessons as unknown as { date: string; lesson_types: { name_en: string } | null } | null
      const school = b.schools as unknown as { name: string } | null
      const isRefund = b.status === 'cancelled' && b.credit_refunded
      return {
        id: b.id,
        date: b.booked_at,
        lesson_date: lesson?.date ?? null,
        lesson_name: lesson?.lesson_types?.name_en ?? 'Lesson',
        school_name: school?.name ?? '',
        credits: isRefund ? +(b.credits_deducted ?? 0) : -(b.credits_deducted ?? 0),
        type: isRefund ? 'refund' : b.status === 'no_show' ? 'no_show' : 'deducted',
        status: b.status,
      }
    })

  return NextResponse.json({ totalCredits, packages: packages ?? [], history })
}
