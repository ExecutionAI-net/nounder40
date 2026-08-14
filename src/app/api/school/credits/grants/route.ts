import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('school_id')
      .eq('id', user.id)
      .single()

    if (!profile?.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { data: grants, error } = await supabase
      .from('manual_credit_grants')
      .select('id, amount, reason, note, created_at, student_id, granted_by, price, payment_method, package_name')
      .eq('school_id', profile.school_id)
      .order('created_at', { ascending: false })
      .limit(200)

    if (error) {
      console.error('[credits/grants GET]', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Fetch student + granter profiles
    const allIds = [
      ...new Set([
        ...(grants ?? []).map(g => g.student_id),
        ...(grants ?? []).map(g => g.granted_by),
      ])
    ]

    const { data: profiles } = allIds.length > 0
      ? await supabase.from('profiles').select('id, name, email').in('id', allIds)
      : { data: [] }

    const profileMap: Record<string, { name: string; email: string }> = {}
    for (const p of profiles ?? []) profileMap[p.id] = p

    return NextResponse.json(
      (grants ?? []).map(g => ({
        ...g,
        student: profileMap[g.student_id] ?? null,
        granter: profileMap[g.granted_by] ?? null,
      }))
    )
  } catch (err) {
    console.error('[credits/grants GET] unexpected', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
