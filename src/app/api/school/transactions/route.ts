import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('school_id')
    .eq('id', user.id)
    .single()

  const school = profile?.school_id ? { id: profile.school_id } : null
  if (!school) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const method = searchParams.get('method')
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  let query = supabase
    .from('transactions')
    .select(`
      id, type, product_name, amount, currency,
      platform_fee, school_amount, payment_method,
      stripe_payment_id, status, created_at,
      students(id, name, email)
    `)
    .eq('school_id', school.id)
    .order('created_at', { ascending: false })

  if (status) query = query.eq('status', status)
  if (method) query = query.eq('payment_method', method)
  if (from) query = query.gte('created_at', from)
  if (to) query = query.lte('created_at', to)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}

export async function POST(request: Request) {
  // Manual transaction (cash, bank transfer, POS)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('school_id')
    .eq('id', user.id)
    .single()

  const school = profile?.school_id ? { id: profile.school_id } : null
  if (!school) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { student_id, type, product_id, product_name, amount, payment_method } = body

  if (!student_id || !type || !product_name || !amount || !payment_method) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const { data, error } = await supabase.from('transactions').insert({
    school_id: school.id,
    student_id,
    type,
    product_id: product_id ?? null,
    product_name,
    amount,
    currency: 'eur',
    platform_fee: 0,
    school_amount: amount,
    payment_method,
    status: 'completed',
  }).select('id').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // If it's a package manual payment, activate the package
  if (type === 'package' && product_id) {
    const { data: pkg } = await supabase
      .from('packages')
      .select('credits, validity_days')
      .eq('id', product_id)
      .single()

    if (pkg) {
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + pkg.validity_days)

      await supabase.from('student_packages').insert({
        student_id,
        school_id: school.id,
        package_id: product_id,
        credits_total: pkg.credits,
        credits_remaining: pkg.credits,
        purchased_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
        payment_method,
        status: 'active',
      })
    }
  }

  return NextResponse.json({ id: data.id })
}
