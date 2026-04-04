import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, roles')
    .eq('id', user.id)
    .single()

  if (!(profile?.role === 'hq' || profile?.roles?.includes('hq'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const schoolId = searchParams.get('school_id')
  const status = searchParams.get('status')
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  let query = supabase
    .from('transactions')
    .select(`
      id, type, product_name, amount, currency,
      platform_fee, school_amount, payment_method,
      status, created_at,
      schools!transactions_school_id_fkey(id, name, city),
      students!transactions_student_id_fkey(id, name, email)
    `)
    .order('created_at', { ascending: false })
    .limit(500)

  if (schoolId) query = query.eq('school_id', schoolId)
  if (status) query = query.eq('status', status)
  if (from) query = query.gte('created_at', from)
  if (to) query = query.lte('created_at', to)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}
