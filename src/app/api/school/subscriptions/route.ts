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

  const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
  if (!profile?.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await admin()
    .from('subscriptions_catalog')
    .select('*, lesson_types(name_en)')
    .eq('school_id', profile.school_id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
  if (!profile?.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { name_en, name_it, description_en, period_value, period_unit, access_count, lesson_type_restriction, price, auto_renewal, is_vip, color } = body

  if (!name_en || !period_value || !period_unit || price === undefined) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const { data, error } = await admin().from('subscriptions_catalog').insert({
    school_id: profile.school_id,
    name_en, name_it: name_it || name_en,
    description_en: description_en || null,
    period_value: Number(period_value),
    period_unit: period_unit || 'months',
    access_count: access_count ? Number(access_count) : null,
    lesson_type_restriction: lesson_type_restriction || 'all',
    price: Number(price),
    auto_renewal: auto_renewal ?? true,
    is_vip: is_vip || false,
    color: color || '#1F3A6B',
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
